/**
 * What a round of readings is turned into in the store, in two steps.
 *
 * As each request is answered, every video in it gets its reading, its
 * growth figures and its new rate. Only when the round's requests are over
 * is each video read placed in its group and given its next read: a place
 * worked out during the round would set this hour's fresh rate against last
 * hour's rates of everyone not yet read, and when a whole group slows
 * together (every night) each of its videos would look slow in turn.
 */
import type { ActiveVideo, Store } from '../repos/types';
import type { VideoFacts } from '../youtube/dataApi';
import { shortByLength } from '../youtube/shorts';
import { finishTracking, updateGrowth } from './finish';
import { buildCohorts, promiseRate, rankedAt } from './promise';
import { planNextRead, retryPlan } from './tiers';
import type { ViewReading } from './velocity';

const MS_PER_HOUR = 60 * 60 * 1000;
/**
 * A video the API leaves out is treated as gone only the second time in a
 * row. The API now and then omits a video that is still there, and a video
 * set to private for an hour comes back. Even then nothing is deleted:
 * tracking ends with the reason `gone`, and the retention clean-up removes
 * the video in its own time.
 */
export const MISSED_READS_BEFORE_GONE = 2;
/**
 * Two misses count as two only when they are at least six hours apart. One
 * outage at Google can span several hourly rounds; six hours is the longer
 * tier's own interval, so a video is called gone on the evidence of two
 * separate occasions, never of one bad afternoon.
 */
export const MISS_MIN_GAP_MS = 6 * MS_PER_HOUR;
/**
 * A request that asked for more than this many videos and got none back, with
 * nothing unreadable in the reply either, is not believed: that many videos
 * do not vanish together, but an empty or cut-short reply looks just like it.
 * Its videos are put off without a miss being counted. Five or fewer can
 * honestly all be gone (one channel closing), and are counted.
 */
export const SUSPECT_EMPTY_BATCH_ABOVE = 5;

export type ReadStore = Pick<Store, 'videos' | 'readings' | 'growth' | 'tracking' | 'transact'>;

/** What one request added to the round's counts. */
export interface Tally {
  readonly read: number;
  readonly readings: number;
  readonly missing: number;
  readonly finished: number;
  readonly gone: number;
}

export const NO_TALLY: Tally = { read: 0, readings: 0, missing: 0, finished: 0, gone: 0 };

export const plusTally = (a: Tally, b: Partial<Tally>): Tally => ({
  read: a.read + (b.read ?? 0),
  readings: a.readings + (b.readings ?? 0),
  missing: a.missing + (b.missing ?? 0),
  finished: a.finished + (b.finished ?? 0),
  gone: a.gone + (b.gone ?? 0),
});

/** The two moments of a request. */
export interface ReadContext {
  /** What the next read is counted from, the same for every video of the round. */
  readonly cycleStart: Date;
  /** When the reply arrived: the moment its counts were true. */
  readonly repliedAt: Date;
}

export interface BatchReply {
  readonly items: readonly VideoFacts[];
  readonly skipped: number;
}

/** A video read in this round, waiting for the round's end to be placed and planned. */
export interface ReadVideo {
  readonly tracked: ActiveVideo;
  readonly publishedAt: Date;
  readonly rate: number | null;
  /** Its latest readings: all the plan needs to tell whether it is speeding up. */
  readonly recent: readonly ViewReading[];
  readonly readAt: Date;
}

/** How many of a video's latest readings the plan looks at. */
const RECENT_READINGS = 3;

interface Recorded {
  readonly tally: Partial<Tally>;
  /** Null when the read settled the video for good (it is not a Short). */
  readonly awaiting: ReadVideo | null;
}

/** Stores what a read found for one video: its reading, its growth figures and its rate. */
function recordRead(
  store: ReadStore,
  tracked: ActiveVideo,
  facts: VideoFacts,
  repliedAt: Date,
): Recorded {
  const { id, publishedAt, views, likes, comments } = facts;
  store.videos.upsert(facts, repliedAt);
  if (views !== null) {
    store.readings.add({ videoId: id, capturedAt: repliedAt, views, likes, comments });
  }
  const tally = { read: 1, readings: views === null ? 0 : 1 };
  // A video found with no known length (a live broadcast) gets its answer once it has one.
  const isShort =
    tracked.isShort === 'unknown' ? shortByLength(facts.durationSeconds) : tracked.isShort;
  if (isShort !== tracked.isShort) store.tracking.classify(id, isShort);
  if (isShort === 'no') {
    finishTracking(store, { videoId: id, publishedAt, reason: 'not_short', at: repliedAt });
    return { tally: { ...tally, finished: 1 }, awaiting: null };
  }
  const readings = store.readings.list(id, new Date(0), repliedAt);
  updateGrowth(store, id, readings, publishedAt);
  const rate = promiseRate(readings, publishedAt, repliedAt, views);
  store.tracking.setRate(id, rate, repliedAt);
  const recent = readings.slice(-RECENT_READINGS);
  return { tally, awaiting: { tracked, publishedAt, rate, recent, readAt: repliedAt } };
}

/**
 * Places every video read in this round in its group, now that the round's
 * rates are all in, and sets each one's next read or ends its tracking.
 * Returns how many ended.
 */
export function planReadVideos(
  store: ReadStore,
  read: readonly ReadVideo[],
  cycleStart: Date,
): number {
  if (read.length === 0) return 0;
  const active = store.tracking.listActive();
  const cohorts = buildCohorts(
    active.map((video) => rankedAt(video, cycleStart)),
    cycleStart,
  );
  let finished = 0;
  store.transact(() => {
    for (const { tracked, publishedAt, rate, recent, readAt } of read) {
      const ranked = { ...rankedAt(tracked, cycleStart), publishedAt, rate };
      const plan = planNextRead({
        publishedAt,
        now: cycleStart,
        readings: recent,
        position: cohorts.positionOf(ranked),
        lowStreak: tracked.lowStreak,
      });
      const { videoId } = tracked;
      if (plan.tier === 'done') {
        finishTracking(store, { videoId, publishedAt, reason: plan.reason, at: readAt });
        finished += 1;
      } else {
        const standing = { lowStreak: plan.lowStreak, rate, rateAt: readAt };
        store.tracking.move(videoId, plan.tier, plan.nextReadAt, standing);
      }
    }
  });
  return finished;
}

/**
 * Notes that a read did not find a video. After enough misses on separate
 * occasions its tracking ends as gone; the video itself is never deleted here.
 */
function recordMissing(
  store: ReadStore,
  tracked: ActiveVideo,
  context: ReadContext,
): Partial<Tally> {
  const { videoId, publishedAt } = tracked;
  const at = context.repliedAt;
  const retry =
    tracked.tier === 'done' ? null : retryPlan(tracked.tier, publishedAt, context.cycleStart);
  if (retry === null) {
    finishTracking(store, { videoId, publishedAt, reason: 'aged_out', at });
    return { missing: 1, finished: 1 };
  }
  const missed = store.tracking.markMissed({ videoId, ...retry, at, minGapMs: MISS_MIN_GAP_MS });
  if (missed < MISSED_READS_BEFORE_GONE) return { missing: 1 };
  finishTracking(store, { videoId, publishedAt, reason: 'gone', at });
  return { missing: 1, finished: 1, gone: 1 };
}

/** Puts off a video whose absence from a reply proves nothing, without counting a miss. */
function putOff(store: ReadStore, tracked: ActiveVideo, context: ReadContext): void {
  const { videoId, publishedAt } = tracked;
  const retry =
    tracked.tier === 'done' ? null : retryPlan(tracked.tier, publishedAt, context.cycleStart);
  if (retry === null) {
    finishTracking(store, { videoId, publishedAt, reason: 'aged_out', at: context.repliedAt });
  } else store.tracking.move(videoId, retry.tier, retry.nextReadAt);
}

/** Whether a reply's silence about a video cannot be taken as "the video is gone". */
export const provesNothing = (batch: readonly ActiveVideo[], reply: BatchReply): boolean =>
  // With an unreadable entry in the reply, an absent video may be that entry.
  reply.skipped > 0 ||
  // Many asked for and none returned is an empty reply, not many deletions.
  (reply.items.length === 0 && batch.length > SUSPECT_EMPTY_BATCH_ABOVE);

export interface StoredBatch {
  readonly tally: Tally;
  /** The videos of the batch that were read and still await their place and plan. */
  readonly read: readonly ReadVideo[];
}

/** Writes one request's worth of readings as one, so a batch is stored whole or not at all. */
export function storeBatch(
  store: ReadStore,
  batch: readonly ActiveVideo[],
  reply: BatchReply,
  context: ReadContext,
): StoredBatch {
  const found = new Map(reply.items.map((facts) => [facts.id, facts]));
  const doubtful = provesNothing(batch, reply);
  let tally = NO_TALLY;
  let read: readonly ReadVideo[] = [];
  store.transact(() => {
    for (const tracked of batch) {
      const facts = found.get(tracked.videoId);
      if (facts !== undefined) {
        const recorded = recordRead(store, tracked, facts, context.repliedAt);
        tally = plusTally(tally, recorded.tally);
        if (recorded.awaiting !== null) read = [...read, recorded.awaiting];
      } else if (doubtful) putOff(store, tracked, context);
      else tally = plusTally(tally, recordMissing(store, tracked, context));
    }
  });
  return { tally, read };
}

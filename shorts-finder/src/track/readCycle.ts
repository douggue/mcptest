/**
 * One round of readings: every tracked video whose time has come is read
 * again, its view count is kept as a reading, and its next read is set by its
 * age. The readings are what the per-hour rate is worked out from.
 */
import { abortReason, stopReasonFor, type StopReason } from '../cycleStop';
import type { QuotaLedger } from '../quota/ledger';
import type { Store, TrackedVideo } from '../repos/types';
import type { YouTubeApi } from '../youtube/api';
import type { VideoFacts } from '../youtube/dataApi';
import { shortByLength } from '../youtube/shorts';
import { DUE_LOOK_AHEAD_MS, planNextRead } from './tiers';

/** The API's limit on videos per request (1 unit). Each request is stored before the next is made. */
export const READ_BATCH_SIZE = 50;
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

export interface ReadCycleDeps {
  readonly api: Pick<YouTubeApi, 'fetchVideos'>;
  readonly ledger: Pick<QuotaLedger, 'markExhausted'>;
  readonly store: Pick<Store, 'videos' | 'readings' | 'tracking' | 'transact'>;
  readonly now: () => Date;
}

export interface ReadCycleReport {
  /** Tracked videos whose read was due. */
  readonly due: number;
  /** Videos the API returned. */
  readonly read: number;
  /** Readings written: the videos read whose view count is visible. */
  readonly readings: number;
  /** Videos the API left out of its reply. */
  readonly missing: number;
  /** Videos whose tracking ended: two weeks old, or found to be too long for a Short. */
  readonly finished: number;
  /** Videos whose tracking ended as gone, after being missing on separate occasions. */
  readonly gone: number;
  /** Entries the API sent that could not be read. */
  readonly skipped: number;
  /** Requests answered with entries of which not one could be read. */
  readonly unreadablePages: number;
  /** Requests for many videos answered with none: not believed, and no miss counted. */
  readonly suspectReplies: number;
  /** Due videos not asked for, because the cycle stopped first. */
  readonly leftUnread: number;
  readonly stopped: StopReason | null;
}

const NOTHING_READ: ReadCycleReport = {
  due: 0,
  read: 0,
  readings: 0,
  missing: 0,
  finished: 0,
  gone: 0,
  skipped: 0,
  unreadablePages: 0,
  suspectReplies: 0,
  leftUnread: 0,
  stopped: null,
};

type Tally = Pick<ReadCycleReport, 'read' | 'readings' | 'missing' | 'finished' | 'gone'>;

const NO_TALLY: Tally = { read: 0, readings: 0, missing: 0, finished: 0, gone: 0 };

const plus = (a: Tally, b: Partial<Tally>): Tally => ({
  read: a.read + (b.read ?? 0),
  readings: a.readings + (b.readings ?? 0),
  missing: a.missing + (b.missing ?? 0),
  finished: a.finished + (b.finished ?? 0),
  gone: a.gone + (b.gone ?? 0),
});

const batchesOf = (due: readonly TrackedVideo[]): readonly (readonly TrackedVideo[])[] =>
  Array.from({ length: Math.ceil(due.length / READ_BATCH_SIZE) }, (_, index) =>
    due.slice(index * READ_BATCH_SIZE, (index + 1) * READ_BATCH_SIZE),
  );

/** The two moments of a request: when its round began, and when its reply came. */
interface Moments {
  /** What the next read is counted from, the same for every video of the round. */
  readonly cycleStart: Date;
  /** When the reply arrived: the moment its view counts were true. */
  readonly repliedAt: Date;
}

/** Stores what a read found for one video and sets when it is read next. */
function recordRead(
  store: ReadCycleDeps['store'],
  tracked: TrackedVideo,
  facts: VideoFacts,
  when: Moments,
): Partial<Tally> {
  store.videos.upsert(facts, when.repliedAt);
  const visible = facts.views !== null;
  if (facts.views !== null) {
    store.readings.add({ videoId: facts.id, capturedAt: when.repliedAt, views: facts.views });
  }
  // A video found with no known length (a live broadcast) gets its answer once it has one.
  const isShort =
    tracked.isShort === 'unknown' ? shortByLength(facts.durationSeconds) : tracked.isShort;
  if (isShort !== tracked.isShort) store.tracking.classify(facts.id, isShort);
  const plan = planNextRead(facts.publishedAt, when.cycleStart);
  if (isShort === 'no' || plan.tier === 'done') {
    const reason = isShort === 'no' ? 'not_short' : 'aged_out';
    store.tracking.finish(facts.id, reason, when.repliedAt);
    return { read: 1, readings: visible ? 1 : 0, finished: 1 };
  }
  store.tracking.move(facts.id, plan.tier, plan.nextReadAt);
  return { read: 1, readings: visible ? 1 : 0 };
}

/**
 * Notes that a read did not find a video. After enough misses on separate
 * occasions its tracking ends as gone; the video itself is never deleted here.
 */
function recordMissing(
  store: ReadCycleDeps['store'],
  tracked: TrackedVideo,
  when: Moments,
): Partial<Tally> {
  const plan = planNextRead(tracked.publishedAt, when.cycleStart);
  if (plan.tier === 'done') {
    store.tracking.finish(tracked.videoId, 'aged_out', when.repliedAt);
    return { missing: 1, finished: 1 };
  }
  const missed = store.tracking.markMissed({
    videoId: tracked.videoId,
    tier: plan.tier,
    nextReadAt: plan.nextReadAt,
    at: when.repliedAt,
    minGapMs: MISS_MIN_GAP_MS,
  });
  if (missed < MISSED_READS_BEFORE_GONE) return { missing: 1 };
  store.tracking.finish(tracked.videoId, 'gone', when.repliedAt);
  return { missing: 1, finished: 1, gone: 1 };
}

/** Puts off a video whose absence from a reply proves nothing, without counting a miss. */
function putOff(store: ReadCycleDeps['store'], tracked: TrackedVideo, when: Moments): void {
  const plan = planNextRead(tracked.publishedAt, when.cycleStart);
  if (plan.tier === 'done') store.tracking.finish(tracked.videoId, 'aged_out', when.repliedAt);
  else store.tracking.move(tracked.videoId, plan.tier, plan.nextReadAt);
}

interface BatchReply {
  readonly items: readonly VideoFacts[];
  readonly skipped: number;
}

/** Whether a reply's silence about a video cannot be taken as "the video is gone". */
const provesNothing = (batch: readonly TrackedVideo[], reply: BatchReply): boolean =>
  // With an unreadable entry in the reply, an absent video may be that entry.
  reply.skipped > 0 ||
  // Many asked for and none returned is an empty reply, not many deletions.
  (reply.items.length === 0 && batch.length > SUSPECT_EMPTY_BATCH_ABOVE);

/** Writes one request's worth of readings as one, so a batch is stored whole or not at all. */
function storeBatch(
  store: ReadCycleDeps['store'],
  batch: readonly TrackedVideo[],
  reply: BatchReply,
  when: Moments,
): Tally {
  const found = new Map(reply.items.map((facts) => [facts.id, facts]));
  const doubtful = provesNothing(batch, reply);
  let tally = NO_TALLY;
  store.transact(() => {
    for (const tracked of batch) {
      const facts = found.get(tracked.videoId);
      if (facts !== undefined) tally = plus(tally, recordRead(store, tracked, facts, when));
      else if (doubtful) putOff(store, tracked, when);
      else tally = plus(tally, recordMissing(store, tracked, when));
    }
  });
  return tally;
}

/**
 * Reads every tracked video that is due, fifty per request, storing each
 * request's readings before making the next. It stops cleanly, saying what
 * was left, when the allowance runs out, when Google asks for a pause, when
 * the lease is lost or when the service is stopping. Any other failed request
 * is thrown, after the requests before it have been stored.
 */
export async function runReadCycle(
  deps: ReadCycleDeps,
  signal?: AbortSignal,
): Promise<ReadCycleReport> {
  // Next reads are counted from the round's start, so every video of a round
  // falls due together for the next one. Each reading carries the time of its
  // own reply: a round of many requests takes minutes, and a rate is only as
  // good as the times it is measured between.
  const cycleStart = deps.now();
  const due = deps.store.tracking.listDue(new Date(cycleStart.getTime() + DUE_LOOK_AHEAD_MS));
  let report: ReadCycleReport = { ...NOTHING_READ, due: due.length, leftUnread: due.length };
  for (const batch of batchesOf(due)) {
    const aborted = abortReason(signal);
    if (aborted !== null) return { ...report, stopped: aborted };
    const result = await deps.api.fetchVideos(batch.map((tracked) => tracked.videoId));
    if (result.error !== null) {
      const stopped = stopReasonFor(result.error, deps.ledger);
      if (stopped === null) throw result.error;
      return { ...report, stopped };
    }
    const none = result.items.length === 0;
    report = {
      ...report,
      ...plus(report, storeBatch(deps.store, batch, result, { cycleStart, repliedAt: deps.now() })),
      skipped: report.skipped + result.skipped,
      unreadablePages: report.unreadablePages + (none && result.skipped > 0 ? 1 : 0),
      suspectReplies:
        report.suspectReplies +
        (none && result.skipped === 0 && provesNothing(batch, result) ? 1 : 0),
      leftUnread: report.leftUnread - batch.length,
    };
  }
  return report;
}

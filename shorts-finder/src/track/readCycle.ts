/**
 * One round of readings: every tracked video whose time has come is read
 * again, its view count is kept as a reading, and its next read is set by its
 * age. The readings are what the per-hour rate is worked out from.
 */
import { stopReasonFor, type StopReason } from '../cycleStop';
import type { QuotaLedger } from '../quota/ledger';
import type { Store, TrackedVideo } from '../repos/types';
import type { YouTubeApi } from '../youtube/api';
import type { VideoFacts } from '../youtube/dataApi';
import { shortByLength } from '../youtube/shorts';
import { planNextRead } from './tiers';

/** The API's limit on videos per request (1 unit). Each request is stored before the next is made. */
export const READ_BATCH_SIZE = 50;
/**
 * A video the API leaves out is treated as gone only the second time in a
 * row. The API now and then omits a video that is still there, and a video
 * set to private for an hour comes back; dropping on the first miss would
 * throw away tracking that cannot be started again.
 */
export const MISSED_READS_BEFORE_DROP = 2;

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
  /** Videos deleted from the store after being missing twice in a row. */
  readonly removed: number;
  /** Entries the API sent that could not be read. */
  readonly skipped: number;
  /** Requests answered with entries of which not one could be read. */
  readonly unreadablePages: number;
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
  removed: 0,
  skipped: 0,
  unreadablePages: 0,
  leftUnread: 0,
  stopped: null,
};

type Tally = Pick<ReadCycleReport, 'read' | 'readings' | 'missing' | 'finished' | 'removed'>;

const NO_TALLY: Tally = { read: 0, readings: 0, missing: 0, finished: 0, removed: 0 };

const plus = (a: Tally, b: Partial<Tally>): Tally => ({
  read: a.read + (b.read ?? 0),
  readings: a.readings + (b.readings ?? 0),
  missing: a.missing + (b.missing ?? 0),
  finished: a.finished + (b.finished ?? 0),
  removed: a.removed + (b.removed ?? 0),
});

const batchesOf = (due: readonly TrackedVideo[]): readonly (readonly TrackedVideo[])[] =>
  Array.from({ length: Math.ceil(due.length / READ_BATCH_SIZE) }, (_, index) =>
    due.slice(index * READ_BATCH_SIZE, (index + 1) * READ_BATCH_SIZE),
  );

/** Stores what a read found for one video and sets when it is read next. */
function recordRead(
  store: ReadCycleDeps['store'],
  tracked: TrackedVideo,
  facts: VideoFacts,
  now: Date,
): Partial<Tally> {
  store.videos.upsert(facts, now);
  const visible = facts.views !== null;
  if (facts.views !== null) {
    store.readings.add({ videoId: facts.id, capturedAt: now, views: facts.views });
  }
  // A video found with no known length (a live broadcast) gets its answer once it has one.
  const isShort =
    tracked.isShort === 'unknown' ? shortByLength(facts.durationSeconds) : tracked.isShort;
  if (isShort !== tracked.isShort) store.tracking.classify(facts.id, isShort);
  const plan = planNextRead(facts.publishedAt, now);
  if (isShort === 'no' || plan.tier === 'done') {
    store.tracking.finish(facts.id);
    return { read: 1, readings: visible ? 1 : 0, finished: 1 };
  }
  store.tracking.move(facts.id, plan.tier, plan.nextReadAt);
  return { read: 1, readings: visible ? 1 : 0 };
}

/** Notes that a read did not find a video; the second time in a row the video is deleted. */
function recordMissing(
  store: ReadCycleDeps['store'],
  tracked: TrackedVideo,
  now: Date,
): Partial<Tally> {
  const plan = planNextRead(tracked.publishedAt, now);
  if (plan.tier === 'done') {
    store.tracking.finish(tracked.videoId);
    return { missing: 1, finished: 1 };
  }
  const missed = store.tracking.markMissed(tracked.videoId, plan.tier, plan.nextReadAt);
  if (missed < MISSED_READS_BEFORE_DROP) return { missing: 1 };
  // Deleted or made private: nothing about it is kept, readings included.
  store.videos.delete(tracked.videoId);
  return { missing: 1, removed: 1 };
}

/** Puts off a video that may be one of a reply's unreadable entries, without counting a miss. */
function putOff(store: ReadCycleDeps['store'], tracked: TrackedVideo, now: Date): void {
  const plan = planNextRead(tracked.publishedAt, now);
  if (plan.tier === 'done') store.tracking.finish(tracked.videoId);
  else store.tracking.move(tracked.videoId, plan.tier, plan.nextReadAt);
}

/** Writes one request's worth of readings as one, so a batch is stored whole or not at all. */
function storeBatch(
  store: ReadCycleDeps['store'],
  batch: readonly TrackedVideo[],
  result: { readonly items: readonly VideoFacts[]; readonly skipped: number },
  now: Date,
): Tally {
  const found = new Map(result.items.map((facts) => [facts.id, facts]));
  let tally = NO_TALLY;
  store.transact(() => {
    for (const tracked of batch) {
      const facts = found.get(tracked.videoId);
      if (facts !== undefined) tally = plus(tally, recordRead(store, tracked, facts, now));
      // With an unreadable entry in the reply, an absent video may be that
      // entry rather than a deleted video, so it is not counted as missing.
      else if (result.skipped > 0) putOff(store, tracked, now);
      else tally = plus(tally, recordMissing(store, tracked, now));
    }
  });
  return tally;
}

/**
 * Reads every tracked video that is due, fifty per request, storing each
 * request's readings before making the next. It stops cleanly, saying what
 * was left, when the allowance runs out, when Google asks for a pause or when
 * the lease is lost. Any other failed request is thrown, after the requests
 * before it have been stored.
 */
export async function runReadCycle(
  deps: ReadCycleDeps,
  signal?: AbortSignal,
): Promise<ReadCycleReport> {
  // One moment for the whole cycle: every reading of it is taken "at" the same
  // time, and the next read falls due by the time the next cycle starts.
  const now = deps.now();
  const due = deps.store.tracking.listDue(now);
  let report: ReadCycleReport = { ...NOTHING_READ, due: due.length, leftUnread: due.length };
  for (const batch of batchesOf(due)) {
    if (signal?.aborted === true) return { ...report, stopped: 'lease_lost' };
    const result = await deps.api.fetchVideos(batch.map((tracked) => tracked.videoId));
    if (result.error !== null) {
      const stopped = stopReasonFor(result.error, deps.ledger);
      if (stopped === null) throw result.error;
      return { ...report, stopped };
    }
    report = {
      ...report,
      ...plus(report, storeBatch(deps.store, batch, result, now)),
      skipped: report.skipped + result.skipped,
      unreadablePages:
        report.unreadablePages + (result.items.length === 0 && result.skipped > 0 ? 1 : 0),
      leftUnread: report.leftUnread - batch.length,
    };
  }
  return report;
}

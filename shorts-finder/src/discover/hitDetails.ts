/**
 * Reading the details of what searches returned. A search's results are kept
 * as "pending" the moment the search answers; here the videos not yet stored
 * are read, the ones short enough to be Shorts are stored and tracked, and the
 * rest are remembered so no later search pays to read them again.
 *
 * A details request that fails, or a program that dies, loses nothing: the
 * pending results are still there for the next round.
 */
import { abortReason, reasonOf, stopReasonFor, type StopReason } from '../cycleStop';
import type { QuotaLedger } from '../quota/ledger';
import type { PendingHit, Store } from '../repos/types';
import { HOURLY_READ_MS } from '../track/tiers';
import type { YouTubeApi } from '../youtube/api';
import type { VideoFacts } from '../youtube/dataApi';
import { shortByLength } from '../youtube/shorts';
import { CHANNEL_REREAD_AFTER_MS } from './channelReads';

const MS_PER_HOUR = 60 * 60 * 1000;
/** The API's limit on videos per request (1 unit). Each request is stored before the next is made. */
const DETAILS_BATCH_SIZE = 50;
/**
 * A result still waiting after a day is dropped. By then the video's first
 * hours, which are what a search is for, have passed unread, and a result
 * that cannot be resolved for a day is not going to be.
 */
export const PENDING_HIT_MAX_AGE_MS = 24 * MS_PER_HOUR;
/**
 * A request for more than this many videos that returns none is not believed
 * (see `SUSPECT_EMPTY_BATCH_ABOVE` in the read cycle, the same reasoning):
 * its results stay pending rather than being written off as not returned.
 */
const SUSPECT_EMPTY_BATCH_ABOVE = 5;

export interface HitDetailsDeps {
  readonly api: Pick<YouTubeApi, 'fetchVideos'>;
  readonly ledger: Pick<QuotaLedger, 'markExhausted'>;
  readonly store: Store;
  readonly now: () => Date;
}

export interface HitDetailsReport {
  /** New videos stored and now tracked. */
  readonly newVideos: number;
  /** New videos left out for being longer than a Short. */
  readonly tooLong: number;
  /** Videos a search returned that the details request did not. */
  readonly notReturned: number;
  /** Entries in the details' replies that could not be read. */
  readonly skipped: number;
  /** Results still waiting for details when this ended. */
  readonly leftPending: number;
  readonly stopped: StopReason | null;
  /** Why the details could not be read, when it was a failure rather than a reason to stop. */
  readonly failure: string | null;
}

export const NO_DETAILS: HitDetailsReport = {
  newVideos: 0,
  tooLong: 0,
  notReturned: 0,
  skipped: 0,
  leftPending: 0,
  stopped: null,
  failure: null,
};

/** Adds up two rounds of details; the later one says what is left and how it ended. */
export const plusDetails = (a: HitDetailsReport, b: HitDetailsReport): HitDetailsReport => ({
  newVideos: a.newVideos + b.newVideos,
  tooLong: a.tooLong + b.tooLong,
  notReturned: a.notReturned + b.notReturned,
  skipped: a.skipped + b.skipped,
  leftPending: b.leftPending,
  stopped: b.stopped,
  failure: b.failure ?? a.failure,
});

/** Stores a newly found video, its first reading and its tracking, and queues its channel. */
export function storeNewVideo(
  store: Store,
  video: VideoFacts,
  channelTitle: string | null,
  readAt: Date,
): void {
  store.channels.queueRead({
    id: video.channelId,
    title: channelTitle,
    now: readAt,
    staleBefore: new Date(readAt.getTime() - CHANNEL_REREAD_AFTER_MS),
  });
  store.videos.upsert(video, readAt);
  if (video.views !== null) {
    store.readings.add({ videoId: video.id, capturedAt: readAt, views: video.views });
  }
  // Every new video starts on the hourly tier, whatever its age, so a second
  // reading and a first rate come within the hour; the first read then moves
  // an older video to the tier its age calls for.
  const firstRead = new Date(readAt.getTime() + HOURLY_READ_MS);
  store.tracking.start(video.id, shortByLength(video.durationSeconds), firstRead);
}

const batchesOf = (ids: readonly string[]): readonly (readonly string[])[] =>
  Array.from({ length: Math.ceil(ids.length / DETAILS_BATCH_SIZE) }, (_, index) =>
    ids.slice(index * DETAILS_BATCH_SIZE, (index + 1) * DETAILS_BATCH_SIZE),
  );

/** Notes the hit for every waiting result whose video is stored, and stops waiting on it. */
function settle(store: Store, waiting: readonly PendingHit[], stored: ReadonlySet<string>): void {
  for (const hit of waiting) {
    if (stored.has(hit.videoId)) store.hits.add(hit.subjectId, hit.videoId, hit.foundAt);
    store.pending.remove(hit.subjectId, hit.videoId);
  }
}

interface BatchReply {
  readonly items: readonly VideoFacts[];
  readonly skipped: number;
}

type Counts = Pick<HitDetailsReport, 'newVideos' | 'tooLong' | 'notReturned' | 'skipped'>;

/** Stores one details reply as one: the new videos, what is passed over, and the hits. */
function storeReply(
  store: Store,
  waiting: readonly PendingHit[],
  batch: readonly string[],
  reply: BatchReply,
  repliedAt: Date,
): Counts {
  const returned = new Set(reply.items.map((video) => video.id));
  // A video with no known length (a live broadcast) is kept and marked unknown.
  const kept = reply.items.filter((video) => shortByLength(video.durationSeconds) !== 'no');
  const tooLong = reply.items.filter((video) => shortByLength(video.durationSeconds) === 'no');
  // With an unreadable entry, or nothing at all for many ids, an absent video
  // proves nothing: its results stay pending for the next round.
  const doubtful =
    reply.skipped > 0 || (reply.items.length === 0 && batch.length > SUSPECT_EMPTY_BATCH_ABOVE);
  const absent = doubtful ? [] : batch.filter((id) => !returned.has(id));
  const titles = new Map(waiting.map((hit) => [hit.videoId, hit.channelTitle]));
  const settled = new Set([...returned, ...absent]);
  store.transact(() => {
    kept.forEach((video) => storeNewVideo(store, video, titles.get(video.id) ?? null, repliedAt));
    tooLong.forEach((video) => store.passedOver.add(video.id, 'too_long', repliedAt));
    absent.forEach((id) => store.passedOver.add(id, 'not_returned', repliedAt));
    settle(
      store,
      waiting.filter((hit) => settled.has(hit.videoId)),
      new Set(kept.map((video) => video.id)),
    );
  });
  return {
    newVideos: kept.length,
    tooLong: tooLong.length,
    notReturned: absent.length,
    skipped: reply.skipped,
  };
}

/** Settles, without a request, the waiting results whose videos are stored or passed over already. */
function settleKnown(store: Store, waiting: readonly PendingHit[]): readonly string[] {
  const ids = [...new Set(waiting.map((hit) => hit.videoId))];
  const stored = new Set(store.videos.knownIds(ids));
  const passed = new Set(store.passedOver.knownIds(ids));
  store.transact(() => {
    settle(
      store,
      waiting.filter((hit) => stored.has(hit.videoId) || passed.has(hit.videoId)),
      stored,
    );
  });
  return ids.filter((id) => !stored.has(id) && !passed.has(id));
}

/**
 * Reads the details of every waiting search result, fifty videos a request,
 * paid from the search share (see `SUBJECT_COST_UNITS`). Never throws for a
 * request that fails: the report says what was done, and what still waits.
 */
export async function resolvePendingHits(
  deps: HitDetailsDeps,
  signal?: AbortSignal,
): Promise<HitDetailsReport> {
  const { store } = deps;
  store.pending.deleteOlderThan(new Date(deps.now().getTime() - PENDING_HIT_MAX_AGE_MS));
  const waiting = store.pending.list();
  let report: HitDetailsReport = NO_DETAILS;
  const done = (ending: Partial<HitDetailsReport> = {}): HitDetailsReport => ({
    ...report,
    ...ending,
    leftPending: store.pending.count(),
  });
  for (const batch of batchesOf(settleKnown(store, waiting))) {
    const aborted = abortReason(signal);
    if (aborted !== null) return done({ stopped: aborted });
    const result = await deps.api.fetchVideos(batch, 'search');
    if (result.error !== null) {
      const stopped = stopReasonFor(result.error, deps.ledger);
      return done({ stopped, failure: stopped === null ? reasonOf(result.error) : null });
    }
    const counts = storeReply(store, waiting, batch, result, deps.now());
    report = { ...plusDetails(report, { ...NO_DETAILS, ...counts }) };
  }
  return done();
}

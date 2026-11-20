/**
 * Storing the videos found on followed channels, by either route (the public
 * feed, or the uploads list of the official API). Finding them cost little or
 * nothing; reading their details is one request per fifty, paid from the
 * channel share, and is the only step both routes have in common.
 */
import { abortReason, reasonOf, stopReasonFor, type StopReason } from '../cycleStop';
import type { QuotaLedger } from '../quota/ledger';
import type { HitKind, Store } from '../repos/types';
import { TRACKED_UNTIL_MS } from '../track/tiers';
import type { YouTubeApi } from '../youtube/api';
import type { VideoFacts } from '../youtube/dataApi';
import { shortByLength } from '../youtube/shorts';
import { storeNewVideo } from './hitDetails';

const MS_PER_HOUR = 60 * 60 * 1000;
const DETAILS_BATCH_SIZE = 50;
/** Many asked for and none returned is an empty reply, not many deletions; see the read cycle. */
const SUSPECT_EMPTY_BATCH_ABOVE = 5;

export interface FindsDeps {
  readonly api: Pick<YouTubeApi, 'fetchVideos'>;
  readonly ledger: Pick<QuotaLedger, 'markExhausted'>;
  readonly store: Store;
  readonly now: () => Date;
}

/** How the videos were found, and whether YouTube itself listed them as Shorts. */
export interface FindsSource {
  readonly kind: Extract<HitKind, 'channel_feed' | 'channel_uploads'>;
  /** True for ids from a Shorts-only feed: they are stored as confirmed Shorts. */
  readonly confirmed: boolean;
}

export interface FindsReport {
  /** New videos stored and now tracked. */
  readonly newVideos: number;
  /** Videos left out for being longer than a Short. */
  readonly tooLong: number;
  /** Videos left out for being past the age at which tracking ends. */
  readonly tooOld: number;
  /** Videos the details request did not return. */
  readonly notReturned: number;
  /** Entries in the replies that could not be read. */
  readonly skipped: number;
  readonly stopped: StopReason | null;
  readonly failure: string | null;
}

export const NO_FINDS: FindsReport = {
  newVideos: 0,
  tooLong: 0,
  tooOld: 0,
  notReturned: 0,
  skipped: 0,
  stopped: null,
  failure: null,
};

export const plusFinds = (a: FindsReport, b: FindsReport): FindsReport => ({
  newVideos: a.newVideos + b.newVideos,
  tooLong: a.tooLong + b.tooLong,
  tooOld: a.tooOld + b.tooOld,
  notReturned: a.notReturned + b.notReturned,
  skipped: a.skipped + b.skipped,
  stopped: b.stopped ?? a.stopped,
  failure: b.failure ?? a.failure,
});

/** Which of the given ids are neither stored nor remembered as passed over. */
export function unseenIds(store: Store, ids: readonly string[]): readonly string[] {
  const unique = [...new Set(ids)];
  const known = new Set([...store.videos.knownIds(unique), ...store.passedOver.knownIds(unique)]);
  return unique.filter((id) => !known.has(id));
}

const batchesOf = (ids: readonly string[]): readonly (readonly string[])[] =>
  Array.from({ length: Math.ceil(ids.length / DETAILS_BATCH_SIZE) }, (_, index) =>
    ids.slice(index * DETAILS_BATCH_SIZE, (index + 1) * DETAILS_BATCH_SIZE),
  );

type Verdict = 'keep' | 'too_long' | 'too_old';

function verdictOn(video: VideoFacts, now: Date): Verdict {
  // An uploads list starts with whatever the channel posted last, however long ago.
  if (now.getTime() - video.publishedAt.getTime() >= TRACKED_UNTIL_MS) return 'too_old';
  return shortByLength(video.durationSeconds) === 'no' ? 'too_long' : 'keep';
}

/** Stores a video found on a followed channel, with the hit that says how it was found. */
function keep(store: Store, video: VideoFacts, source: FindsSource, readAt: Date): void {
  // Confirmed outranks the answer by length, except "unknown": a video with
  // no length yet is still listed by YouTube as a Short.
  storeNewVideo(store, video, null, readAt, source.confirmed ? 'confirmed' : undefined);
  store.hits.add({
    // The subject that first led to the channel stands for its later uploads too.
    subjectId: store.hits.firstSubjectForChannel(video.channelId),
    videoId: video.id,
    kind: source.kind,
    rank: null,
    ageHours: Math.max(0, readAt.getTime() - video.publishedAt.getTime()) / MS_PER_HOUR,
    firstSeenAt: readAt,
  });
}

/** Stores one details reply as one. */
function storeReply(
  store: Store,
  batch: readonly string[],
  reply: { readonly items: readonly VideoFacts[]; readonly skipped: number },
  source: FindsSource,
  readAt: Date,
): FindsReport {
  const verdicts = reply.items.map((video) => ({ video, verdict: verdictOn(video, readAt) }));
  const returned = new Set(reply.items.map((video) => video.id));
  const doubtful =
    reply.skipped > 0 || (reply.items.length === 0 && batch.length > SUSPECT_EMPTY_BATCH_ABOVE);
  const absent = doubtful ? [] : batch.filter((id) => !returned.has(id));
  store.transact(() => {
    for (const { video, verdict } of verdicts) {
      if (verdict === 'keep') keep(store, video, source, readAt);
      else store.passedOver.add(video.id, verdict, readAt);
    }
    absent.forEach((id) => store.passedOver.add(id, 'not_returned', readAt));
  });
  const count = (verdict: Verdict): number =>
    verdicts.filter((entry) => entry.verdict === verdict).length;
  return {
    ...NO_FINDS,
    newVideos: count('keep'),
    tooLong: count('too_long'),
    tooOld: count('too_old'),
    notReturned: absent.length,
    skipped: reply.skipped,
  };
}

/**
 * Reads the details of videos found on followed channels and stores the ones
 * worth tracking. `ids` should be unseen ones (see `unseenIds`). Never throws
 * for a request that fails: the report says how it ended.
 */
export async function detailChannelFinds(
  deps: FindsDeps,
  ids: readonly string[],
  source: FindsSource,
  signal?: AbortSignal,
): Promise<FindsReport> {
  let report = NO_FINDS;
  for (const batch of batchesOf(ids)) {
    const aborted = abortReason(signal);
    if (aborted !== null) return { ...report, stopped: aborted };
    const result = await deps.api.fetchVideos(batch, 'channel');
    if (result.error !== null) {
      const stopped = stopReasonFor(result.error, deps.ledger);
      return { ...report, stopped, failure: stopped === null ? reasonOf(result.error) : null };
    }
    report = plusFinds(report, storeReply(deps.store, batch, result, source, deps.now()));
  }
  return report;
}

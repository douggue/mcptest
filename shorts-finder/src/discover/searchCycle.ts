/**
 * One round of searching: every subject whose time has come is searched once,
 * the videos it finds that are new and short enough are stored and tracked,
 * and their channels are queued for a read of their facts.
 *
 * Search is only the net. It returns the most-viewed recent videos, large
 * channels among them; what is worth reporting is decided later, from the
 * readings that tracking collects.
 */
import { reasonOf, stopReasonFor, type StopReason } from '../cycleStop';
import type { QuotaLedger } from '../quota/ledger';
import type { Store, Subject } from '../repos/types';
import { pickDueSubjects } from '../subjects/due';
import { HOURLY_READ_MS } from '../track/tiers';
import type { YouTubeApi } from '../youtube/api';
import type { SearchHit, VideoFacts } from '../youtube/dataApi';
import { shortByLength } from '../youtube/shorts';
import {
  CHANNEL_REREAD_AFTER_MS,
  readQueuedChannels,
  type ChannelReadsReport,
} from './channelReads';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/**
 * A search asks for videos published in the last seven days. A subject is
 * searched once a day, so a video has seven chances to be seen, which covers
 * a slow start and a day or two of the service being down; and a video found
 * later than that has little of its 14 days of tracking left to learn from.
 */
export const SEARCH_WINDOW_DAYS = 7;

export interface SearchCycleDeps {
  readonly api: YouTubeApi;
  readonly ledger: Pick<QuotaLedger, 'remaining' | 'markExhausted'>;
  readonly store: Store;
  readonly now: () => Date;
}

export interface SubjectOutcome {
  readonly subjectId: number;
  /** `unreadable` when the search answered but not one of its results could be read. */
  readonly result: 'searched' | 'unreadable';
  /** Videos the search returned, new or known. */
  readonly hits: number;
  /** New videos stored and now tracked. */
  readonly newVideos: number;
  /** New videos left out for being longer than a Short. */
  readonly tooLong: number;
  /** Entries in the search's or the details' reply that could not be read. */
  readonly skipped: number;
}

export interface SubjectFailure {
  readonly subjectId: number;
  readonly reason: string;
}

export interface SearchCycleReport {
  readonly searched: readonly SubjectOutcome[];
  /** Subjects whose search failed. They wait their usual hours before the next try. */
  readonly failed: readonly SubjectFailure[];
  /** Due subjects not searched: the allowance could not pay, or the cycle was stopped. */
  readonly leftUndone: readonly number[];
  /** Why the searching ended before every affordable subject was searched; null when it did not. */
  readonly stopped: StopReason | null;
  readonly channels: ChannelReadsReport;
}

const NO_CHANNEL_READS: ChannelReadsReport = {
  read: 0,
  unavailable: 0,
  skipped: 0,
  leftQueued: 0,
  stopped: null,
  failure: null,
};

type Attempt =
  | { readonly kind: 'searched'; readonly outcome: SubjectOutcome }
  | { readonly kind: 'failed'; readonly failure: SubjectFailure }
  | { readonly kind: 'stopped'; readonly reason: StopReason };

/** Stores a newly found video, its first reading and its tracking, and queues its channel. */
function storeNewVideo(
  store: Store,
  video: VideoFacts,
  channelTitle: string | null,
  now: Date,
): void {
  store.channels.queueRead({
    id: video.channelId,
    title: channelTitle,
    now,
    staleBefore: new Date(now.getTime() - CHANNEL_REREAD_AFTER_MS),
  });
  store.videos.upsert(video, now);
  if (video.views !== null) {
    store.readings.add({ videoId: video.id, capturedAt: now, views: video.views });
  }
  // Every new video starts on the hourly tier, whatever its age, so a second
  // reading and a first rate come within the hour; the first read then moves
  // an older video to the tier its age calls for.
  const firstRead = new Date(now.getTime() + HOURLY_READ_MS);
  store.tracking.start(video.id, shortByLength(video.durationSeconds), firstRead);
}

interface Kept {
  readonly newVideos: number;
  readonly tooLong: number;
  readonly skipped: number;
  readonly error: Error | null;
}

/** Reads the details of the hits not stored yet and keeps the ones short enough to be Shorts. */
async function keepNewVideos(
  deps: SearchCycleDeps,
  subject: Subject,
  hits: readonly SearchHit[],
  now: Date,
): Promise<Kept> {
  const { store } = deps;
  const hitIds = [...new Set(hits.map((hit) => hit.videoId))];
  const known = store.videos.knownIds(hitIds);
  const fresh = hitIds.filter((id) => !known.includes(id));
  // Paid from the search share: see SUBJECT_COST_UNITS.
  const details =
    fresh.length === 0
      ? { items: [], skipped: 0, error: null }
      : await deps.api.fetchVideos(fresh, 'search');
  // A video with no known length (a live broadcast) is kept and marked unknown.
  const kept = details.items.filter((video) => shortByLength(video.durationSeconds) !== 'no');
  const channelTitles = new Map(hits.map((hit) => [hit.videoId, hit.channelTitle]));
  store.transact(() => {
    kept.forEach((video) => storeNewVideo(store, video, channelTitles.get(video.id) ?? null, now));
    [...known, ...kept.map((video) => video.id)].forEach((id) =>
      store.hits.add(subject.id, id, now),
    );
  });
  return {
    newVideos: kept.length,
    tooLong: details.items.length - kept.length,
    skipped: details.skipped,
    error: details.error,
  };
}

async function searchSubject(deps: SearchCycleDeps, subject: Subject, now: Date): Promise<Attempt> {
  try {
    const found = await deps.api.searchRecentVideos(subject.keyword, {
      publishedAfter: new Date(now.getTime() - SEARCH_WINDOW_DAYS * MS_PER_DAY),
      regionCode: subject.region,
      ...(subject.language === null ? {} : { relevanceLanguage: subject.language }),
      shortOnly: true,
    });
    const kept = await keepNewVideos(deps, subject, found.hits, now);
    if (kept.error !== null) throw kept.error;
    deps.store.subjects.markSearched(subject.id, now);
    const unreadable = found.hits.length === 0 && found.skipped > 0;
    const outcome: SubjectOutcome = {
      subjectId: subject.id,
      result: unreadable ? 'unreadable' : 'searched',
      hits: found.hits.length,
      newVideos: kept.newVideos,
      tooLong: kept.tooLong,
      skipped: found.skipped + kept.skipped,
    };
    return { kind: 'searched', outcome };
  } catch (error) {
    const reason = stopReasonFor(error, deps.ledger);
    if (reason !== null) return { kind: 'stopped', reason };
    // A failed search has been paid for. The subject waits its usual hours, so
    // a keyword the API refuses every time cannot drain the day's searches.
    deps.store.subjects.markSearched(subject.id, now);
    return { kind: 'failed', failure: { subjectId: subject.id, reason: reasonOf(error) } };
  }
}

/**
 * Searches the due subjects the search share can pay for, oldest-searched
 * first, then reads the queued channels. It does not throw when the allowance
 * runs out, when Google asks for a pause or when one subject fails: the
 * report says what was done and what was left.
 */
export async function runSearchCycle(
  deps: SearchCycleDeps,
  signal?: AbortSignal,
): Promise<SearchCycleReport> {
  const now = deps.now();
  const due = deps.store.subjects.listDue(now);
  const affordable = pickDueSubjects(due, now, deps.ledger.remaining(now).byKind.search);
  let searched: readonly SubjectOutcome[] = [];
  let failed: readonly SubjectFailure[] = [];
  let stopped: StopReason | null = null;
  for (const subject of affordable) {
    const attempt: Attempt =
      signal?.aborted === true
        ? { kind: 'stopped', reason: 'lease_lost' }
        : await searchSubject(deps, subject, now);
    if (attempt.kind === 'stopped') {
      stopped = attempt.reason;
      break;
    }
    if (attempt.kind === 'searched') searched = [...searched, attempt.outcome];
    else failed = [...failed, attempt.failure];
  }
  const done = new Set([...searched, ...failed].map((entry) => entry.subjectId));
  const leftUndone = due.filter((subject) => !done.has(subject.id)).map((subject) => subject.id);
  if (stopped === null && leftUndone.length > 0) stopped = 'allowance';
  const channels: ChannelReadsReport =
    stopped === 'lease_lost' || stopped === 'rate_limit'
      ? { ...NO_CHANNEL_READS, leftQueued: deps.store.channels.listQueued().length, stopped }
      : await readQueuedChannels(deps, signal);
  return { searched, failed, leftUndone, stopped, channels };
}

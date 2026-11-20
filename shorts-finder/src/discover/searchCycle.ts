/**
 * One round of searching: every subject whose time has come is searched once,
 * the videos it finds that are new and short enough are stored and tracked,
 * and their channels are queued for a read of their facts.
 *
 * A search is paid for the moment it answers, so that is when its results are
 * kept and the subject is marked as searched; the details of the videos are
 * read afterwards (`hitDetails.ts`), and a failure there costs no search.
 *
 * Search is only the net. It returns the most-viewed recent videos, large
 * channels among them; what is worth reporting is decided later, from the
 * readings that tracking collects.
 */
import { abortReason, reasonOf, stopReasonFor, type StopReason } from '../cycleStop';
import type { QuotaLedger } from '../quota/ledger';
import type { Store, Subject } from '../repos/types';
import { pickDueSubjects } from '../subjects/due';
import type { YouTubeApi } from '../youtube/api';
import type { SearchResult } from '../youtube/dataApi';
import { readQueuedChannels, type ChannelReadsReport } from './channelReads';
import { plusDetails, resolvePendingHits, type HitDetailsReport } from './hitDetails';

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
  /** Entries in the search's reply that could not be read. */
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
  /** What reading the details of the results came to, over the whole round. */
  readonly details: HitDetailsReport;
  readonly channels: ChannelReadsReport;
}

const NO_CHANNEL_READS: ChannelReadsReport = {
  read: 0,
  unavailable: 0,
  skipped: 0,
  gaveUp: 0,
  leftQueued: 0,
  stopped: null,
  failure: null,
};

type Attempt =
  | { readonly kind: 'searched'; readonly outcome: SubjectOutcome }
  | { readonly kind: 'failed'; readonly failure: SubjectFailure }
  | { readonly kind: 'stopped'; readonly reason: StopReason };

/** Keeps a search's results and marks the subject searched, as one, at the time of the reply. */
function keepResults(store: Store, subject: Subject, found: SearchResult, foundAt: Date): void {
  store.transact(() => {
    for (const hit of found.hits) {
      store.pending.add({
        subjectId: subject.id,
        videoId: hit.videoId,
        channelId: hit.channelId,
        channelTitle: hit.channelTitle,
        foundAt,
      });
    }
    store.subjects.markSearched(subject.id, foundAt);
  });
}

async function searchSubject(deps: SearchCycleDeps, subject: Subject, now: Date): Promise<Attempt> {
  try {
    const found = await deps.api.searchRecentVideos(subject.keyword, {
      publishedAfter: new Date(now.getTime() - SEARCH_WINDOW_DAYS * MS_PER_DAY),
      regionCode: subject.region,
      ...(subject.language === null ? {} : { relevanceLanguage: subject.language }),
      shortOnly: true,
    });
    keepResults(deps.store, subject, found, deps.now());
    const unreadable = found.hits.length === 0 && found.skipped > 0;
    const outcome: SubjectOutcome = {
      subjectId: subject.id,
      result: unreadable ? 'unreadable' : 'searched',
      hits: found.hits.length,
      skipped: found.skipped,
    };
    return { kind: 'searched', outcome };
  } catch (error) {
    const reason = stopReasonFor(error, deps.ledger);
    if (reason !== null) return { kind: 'stopped', reason };
    // A failed search has been paid for. The subject waits its usual hours, so
    // a keyword the API refuses every time cannot drain the day's searches.
    deps.store.subjects.markSearched(subject.id, deps.now());
    return { kind: 'failed', failure: { subjectId: subject.id, reason: reasonOf(error) } };
  }
}

interface Searching {
  readonly searched: readonly SubjectOutcome[];
  readonly failed: readonly SubjectFailure[];
  readonly details: HitDetailsReport;
  readonly stopped: StopReason | null;
}

/** Searches the given subjects in turn, reading each search's details before the next search. */
async function searchAll(
  deps: SearchCycleDeps,
  subjects: readonly Subject[],
  now: Date,
  signal?: AbortSignal,
): Promise<Searching> {
  // Results left waiting by an earlier round come first: they are paid for already.
  let state: Searching = {
    searched: [],
    failed: [],
    details: await resolvePendingHits(deps, signal),
    stopped: null,
  };
  for (const subject of subjects) {
    const halted = abortReason(signal) ?? state.details.stopped;
    if (halted !== null) return { ...state, stopped: halted };
    const attempt = await searchSubject(deps, subject, now);
    if (attempt.kind === 'stopped') return { ...state, stopped: attempt.reason };
    if (attempt.kind === 'failed') state = { ...state, failed: [...state.failed, attempt.failure] };
    else {
      const details = plusDetails(state.details, await resolvePendingHits(deps, signal));
      state = { ...state, searched: [...state.searched, attempt.outcome], details };
    }
  }
  return { ...state, stopped: state.details.stopped };
}

/** A stop after which nothing more should be asked of YouTube in this round. */
const endsTheRound = (stopped: StopReason | null): boolean =>
  stopped === 'lease_lost' || stopped === 'rate_limit' || stopped === 'shutdown';

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
  const {
    searched,
    failed,
    details,
    stopped: halted,
  } = await searchAll(deps, affordable, now, signal);
  const done = new Set([...searched, ...failed].map((entry) => entry.subjectId));
  const leftUndone = due.filter((subject) => !done.has(subject.id)).map((subject) => subject.id);
  const stopped = halted ?? (leftUndone.length > 0 ? 'allowance' : null);
  const channels: ChannelReadsReport = endsTheRound(stopped)
    ? { ...NO_CHANNEL_READS, leftQueued: deps.store.channels.listQueued().length, stopped }
    : await readQueuedChannels(deps, signal);
  return { searched, failed, leftUndone, stopped, details, channels };
}

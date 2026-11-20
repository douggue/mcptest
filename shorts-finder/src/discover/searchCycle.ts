/**
 * One round of searching: every search whose time has come is made once, the
 * videos it finds that are new and short enough are stored and tracked, and
 * their channels are queued for a read of their facts.
 *
 * Each subject is searched in two ways (see `subjects/sweep.ts`): the
 * most-viewed of the last two days, and everything new since the last sweep.
 * A search is paid for the moment it answers, so that is when its results are
 * kept and the subject is marked as searched; the details of the videos are
 * read afterwards (`hitDetails.ts`), and a failure there costs no search.
 *
 * Search is only the net. What is worth reporting is decided later, from the
 * readings that tracking collects.
 */
import { abortReason, reasonOf, stopReasonFor, type StopReason } from '../cycleStop';
import type { QuotaLedger } from '../quota/ledger';
import type { SearchKind, Store } from '../repos/types';
import { dueSearches, pickDueSubjects, type DueSearch } from '../subjects/due';
import { ORDER_OF, nextNewestInterval, publishedAfterFor } from '../subjects/sweep';
import type { YouTubeApi } from '../youtube/api';
import type { SearchResult } from '../youtube/dataApi';
import { readQueuedChannels, type ChannelReadsReport } from './channelReads';
import type { FollowSettings } from './follow';
import { plusDetails, resolvePendingHits, type HitDetailsReport } from './hitDetails';

export interface SearchCycleDeps {
  readonly api: YouTubeApi;
  readonly ledger: Pick<QuotaLedger, 'remaining' | 'markExhausted'>;
  readonly store: Store;
  readonly now: () => Date;
  /** Which channels are followed once their facts are read; the defaults when not given. */
  readonly follow?: FollowSettings;
}

/** One search of one subject. */
export interface SearchRef {
  readonly subjectId: number;
  readonly kind: SearchKind;
}

export interface SubjectOutcome extends SearchRef {
  /** `unreadable` when the search answered but not one of its results could be read. */
  readonly result: 'searched' | 'unreadable';
  /** Videos the search returned, new or known. */
  readonly hits: number;
  /** Entries in the search's reply that could not be read. */
  readonly skipped: number;
  /** True when the reply held a full page: there were probably more behind it. */
  readonly fullPage: boolean;
}

export interface SubjectFailure extends SearchRef {
  readonly reason: string;
}

export interface SearchCycleReport {
  readonly searched: readonly SubjectOutcome[];
  /** Searches that failed. They wait their usual hours before the next try. */
  readonly failed: readonly SubjectFailure[];
  /** Due searches not made: the allowance could not pay, or the cycle was stopped. */
  readonly leftUndone: readonly SearchRef[];
  /** Why the searching ended before every affordable search was made; null when it did not. */
  readonly stopped: StopReason | null;
  /** What reading the details of the results came to, over the whole round. */
  readonly details: HitDetailsReport;
  readonly channels: ChannelReadsReport;
}

const NO_CHANNEL_READS: ChannelReadsReport = {
  read: 0,
  followed: 0,
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

const refOf = (search: DueSearch): SearchRef => ({
  subjectId: search.subject.id,
  kind: search.kind,
});

/** Keeps a search's results and marks the subject searched, as one, at the time of the reply. */
function keepResults(store: Store, search: DueSearch, found: SearchResult, foundAt: Date): void {
  const { subject, kind } = search;
  store.transact(() => {
    for (const hit of found.hits) {
      store.pending.add({
        subjectId: subject.id,
        videoId: hit.videoId,
        kind,
        rank: hit.rank,
        channelId: hit.channelId,
        channelTitle: hit.channelTitle,
        foundAt,
      });
    }
    if (kind === 'top_recent') store.subjects.markSearched(subject.id, kind, foundAt);
    else {
      // The sweep paces itself on its own results: every entry the API sent counts.
      const results = found.hits.length + found.skipped;
      const intervalHours = nextNewestInterval(
        subject.newestIntervalHours,
        subject.newestEveryHours,
        results,
      );
      store.subjects.markSwept(subject.id, { at: foundAt, intervalHours });
    }
  });
}

async function makeSearch(deps: SearchCycleDeps, search: DueSearch, now: Date): Promise<Attempt> {
  const { subject, kind } = search;
  try {
    const found = await deps.api.searchRecentVideos(subject.keyword, {
      order: ORDER_OF[kind],
      publishedAfter: publishedAfterFor(subject, kind, now),
      regionCode: subject.region,
      ...(subject.language === null ? {} : { relevanceLanguage: subject.language }),
      shortOnly: true,
    });
    keepResults(deps.store, search, found, deps.now());
    const unreadable = found.hits.length === 0 && found.skipped > 0;
    const outcome: SubjectOutcome = {
      ...refOf(search),
      result: unreadable ? 'unreadable' : 'searched',
      hits: found.hits.length,
      skipped: found.skipped,
      fullPage: found.fullPage,
    };
    return { kind: 'searched', outcome };
  } catch (error) {
    const reason = stopReasonFor(error, deps.ledger);
    if (reason !== null) return { kind: 'stopped', reason };
    // A failed search has been paid for. It waits its usual hours, so a
    // keyword the API refuses every time cannot drain the day's searches.
    deps.store.subjects.markSearched(subject.id, kind, deps.now());
    return { kind: 'failed', failure: { ...refOf(search), reason: reasonOf(error) } };
  }
}

interface Searching {
  readonly searched: readonly SubjectOutcome[];
  readonly failed: readonly SubjectFailure[];
  readonly details: HitDetailsReport;
  readonly stopped: StopReason | null;
}

/** Makes the given searches in turn, reading each one's details before the next search. */
async function searchAll(
  deps: SearchCycleDeps,
  searches: readonly DueSearch[],
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
  for (const search of searches) {
    const halted = abortReason(signal) ?? state.details.stopped;
    if (halted !== null) return { ...state, stopped: halted };
    const attempt = await makeSearch(deps, search, now);
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

const sameSearch = (a: SearchRef, b: SearchRef): boolean =>
  a.subjectId === b.subjectId && a.kind === b.kind;

/**
 * Makes the due searches the search share can pay for, longest-due first
 * across both kinds, then reads the queued channels. It does not throw when
 * the allowance runs out, when Google asks for a pause or when one search
 * fails: the report says what was done and what was left.
 */
export async function runSearchCycle(
  deps: SearchCycleDeps,
  signal?: AbortSignal,
): Promise<SearchCycleReport> {
  const now = deps.now();
  const subjects = deps.store.subjects.list();
  const due = dueSearches(subjects, now).map(refOf);
  const affordable = pickDueSubjects(subjects, now, deps.ledger.remaining(now).byKind.search);
  const {
    searched,
    failed,
    details,
    stopped: halted,
  } = await searchAll(deps, affordable, now, signal);
  const done: readonly SearchRef[] = [...searched, ...failed];
  const leftUndone = due.filter((search) => !done.some((made) => sameSearch(made, search)));
  const stopped = halted ?? (leftUndone.length > 0 ? 'allowance' : null);
  const channels: ChannelReadsReport = endsTheRound(stopped)
    ? { ...NO_CHANNEL_READS, leftQueued: deps.store.channels.listQueued().length, stopped }
    : await readQueuedChannels(deps, signal);
  return { searched, failed, leftUndone, stopped, details, channels };
}

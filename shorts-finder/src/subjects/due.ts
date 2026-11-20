/**
 * Which searches to make now. Searching is the scarce part of the day's
 * allowance, so the choice is made before anything is spent: across both
 * kinds of search and every subject, the ones due longest go first, and no
 * more are picked than can be paid for.
 */
import type { SearchKind, Subject } from '../repos/types';
import { SEARCH_COST_UNITS } from '../youtube/dataApi';

const MS_PER_HOUR = 60 * 60 * 1000;
/**
 * A search finds at most fifty videos, and reading the new ones' details is
 * one more request. It is paid from the search share too, so a search that
 * can be afforded can always be finished: a search whose results cannot be
 * read is 100 units for nothing.
 */
export const DETAILS_COST_UNITS = 1;
/** What one search of a subject costs the search share. */
export const SUBJECT_COST_UNITS = SEARCH_COST_UNITS + DETAILS_COST_UNITS;

/** One search that is due: a subject, the kind, and since when it has been due. */
export interface DueSearch {
  readonly subject: Subject;
  readonly kind: SearchKind;
  /** The moment it fell due, in milliseconds; minus infinity for a search never made. */
  readonly dueSince: number;
}

const SEARCH_KINDS: readonly SearchKind[] = ['top_recent', 'newest'];

/** When a search of this kind last ran, and the hours it then waits. */
const paceOf = (subject: Subject, kind: SearchKind): { last: Date | null; hours: number } =>
  kind === 'top_recent'
    ? { last: subject.lastSearchedAt, hours: subject.everyHours }
    : { last: subject.newestLastAt, hours: subject.newestIntervalHours };

/** Since when a search of this kind has been due for the subject; null when it is not. */
function dueSince(subject: Subject, kind: SearchKind, now: Date): number | null {
  if (!subject.enabled) return null;
  const { last, hours } = paceOf(subject, kind);
  if (last === null) return Number.NEGATIVE_INFINITY;
  // A last search "in the future" means the clock was set back since. The
  // search is due, rather than held until the clock catches up.
  if (last.getTime() > now.getTime()) return Number.NEGATIVE_INFINITY;
  const due = last.getTime() + hours * MS_PER_HOUR;
  return due <= now.getTime() ? due : null;
}

/** Whether an enabled subject's hours have passed since a search of this kind. */
export const isDue = (subject: Subject, kind: SearchKind, now: Date): boolean =>
  dueSince(subject, kind, now) !== null;

/** Every search that is due at `now`, longest-due first; ties in the order the subjects were added. */
export function dueSearches(subjects: readonly Subject[], now: Date): readonly DueSearch[] {
  return subjects
    .flatMap((subject) =>
      SEARCH_KINDS.flatMap((kind): DueSearch[] => {
        const since = dueSince(subject, kind, now);
        return since === null ? [] : [{ subject, kind, dueSince: since }];
      }),
    )
    .toSorted(
      (a, b) =>
        // Two searches never made tie: minus infinity less itself is not a number.
        (a.dueSince === b.dueSince ? 0 : a.dueSince - b.dueSince) ||
        a.subject.id - b.subject.id ||
        SEARCH_KINDS.indexOf(a.kind) - SEARCH_KINDS.indexOf(b.kind),
    );
}

/**
 * The searches to make now: of enabled subjects, due, the longest-due first
 * whichever kind they are, and only as many as `searchUnitsLeft` (what the
 * ledger says the search share can still spend today) pays for. The rest
 * wait for a later cycle or for tomorrow.
 */
export function pickDueSubjects(
  subjects: readonly Subject[],
  now: Date,
  searchUnitsLeft: number,
): readonly DueSearch[] {
  const affordable = Math.max(0, Math.floor(searchUnitsLeft / SUBJECT_COST_UNITS));
  return dueSearches(subjects, now).slice(0, affordable);
}

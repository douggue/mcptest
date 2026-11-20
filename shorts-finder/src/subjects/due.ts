/**
 * Which subjects to search now. Searching is the scarce part of the day's
 * allowance, so the choice is made before anything is spent: the subjects
 * waiting longest go first, and no more are picked than can be paid for.
 */
import type { Subject } from '../repos/types';
import { SEARCH_COST_UNITS } from '../youtube/dataApi';

const MS_PER_HOUR = 60 * 60 * 1000;
/**
 * A search finds at most fifty videos, and reading the new ones' details is
 * one more request. It is paid from the search share too, so a search that
 * can be afforded can always be finished: a search whose results cannot be
 * read is 100 units for nothing.
 */
export const DETAILS_COST_UNITS = 1;
/** What one subject costs the search share each time it is searched. */
export const SUBJECT_COST_UNITS = SEARCH_COST_UNITS + DETAILS_COST_UNITS;

/** Whether an enabled subject's hours have passed since it was last searched. */
export function isDue(subject: Subject, now: Date): boolean {
  if (!subject.enabled) return false;
  if (subject.lastSearchedAt === null) return true;
  const waited = now.getTime() - subject.lastSearchedAt.getTime();
  // A last search "in the future" means the clock was set back since. The
  // subject is due, rather than held until the clock catches up.
  return waited < 0 || waited >= subject.everyHours * MS_PER_HOUR;
}

/** Never searched sorts before any date; ties keep the order the subjects were added in. */
const waitingLongestFirst = (a: Subject, b: Subject): number =>
  (a.lastSearchedAt?.getTime() ?? Number.NEGATIVE_INFINITY) -
    (b.lastSearchedAt?.getTime() ?? Number.NEGATIVE_INFINITY) || a.id - b.id;

/**
 * The subjects to search now: enabled, due, the longest unsearched first, and
 * only as many as `searchUnitsLeft` (what the ledger says the search share can
 * still spend today) pays for. The rest wait for a later cycle or for tomorrow.
 */
export function pickDueSubjects(
  subjects: readonly Subject[],
  now: Date,
  searchUnitsLeft: number,
): readonly Subject[] {
  const affordable = Math.max(0, Math.floor(searchUnitsLeft / SUBJECT_COST_UNITS));
  return subjects
    .filter((subject) => isDue(subject, now))
    .toSorted(waitingLongestFirst)
    .slice(0, affordable);
}

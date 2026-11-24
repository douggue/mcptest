/**
 * Whether a new idea is close to one already stored for the channel, judged
 * in code from the words of their titles. An engine is told the stored
 * titles and asked not to repeat a subject; this is the check that it did
 * not, shown on the card so the owner can decide.
 *
 * It compares words, not meaning: two titles on one subject in different
 * words are not caught, and two that share their words are flagged even when
 * the angle differs. It is a prompt to look, never a verdict.
 */

/** Words that say nothing of a subject: left out before titles are compared. */
const COMMON = new Set(
  (
    'a an the and or but of in on at to for from by with without into over under about after before ' +
    'is are was were be been it its this that these those how why what when where who which ' +
    'not no new now just still than then so as if you your we our they their he she his her'
  ).split(' '),
);
/** The fewest words two titles must share before they are compared at all. */
const MIN_SHARED = 3;
/** The share of the shorter title's words the two must have in common. */
export const CLOSE_SHARE = 0.7;

/** The words of a title that carry its subject: lower case, no punctuation, no common words. */
export function subjectWords(title: string): ReadonlySet<string> {
  const words = title
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !COMMON.has(word));
  return new Set(words);
}

/** Whether two titles share most of the words that carry their subject. */
export function closeTitles(a: string, b: string): boolean {
  const first = subjectWords(a);
  const second = subjectWords(b);
  const shared = [...first].filter((word) => second.has(word)).length;
  const shorter = Math.min(first.size, second.size);
  return shared >= MIN_SHARED && shared / shorter >= CLOSE_SHARE;
}

export interface TitledIdea {
  readonly id: number;
  readonly title: string;
  readonly altTitles?: readonly string[];
}

/**
 * The stored idea a new one is close to: the earliest of the others whose
 * title, or one of its alternates, shares most of its subject words with one
 * of this idea's. Null when none is. An idea is never close to itself or to
 * one stored after it, so the first of a pair is not flagged.
 */
export function closeIdea<T extends TitledIdea>(idea: TitledIdea, stored: readonly T[]): T | null {
  const titles = (one: TitledIdea): readonly string[] => [one.title, ...(one.altTitles ?? [])];
  const earlier = stored.filter((other) => other.id < idea.id).sort((a, b) => a.id - b.id);
  return (
    earlier.find((other) =>
      titles(idea).some((mine) => titles(other).some((theirs) => closeTitles(mine, theirs))),
    ) ?? null
  );
}

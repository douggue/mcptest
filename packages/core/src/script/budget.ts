import { readBeats } from './stages';

/**
 * The words each section of a script is written to: the hook's words, then
 * the rest of the length shared among the beats by how long each runs on the
 * beat sheet. It always adds up to the whole length, so a draft that meets
 * every section meets the length the owner asked for.
 *
 * A draft asked only for a total tends to come out short: the count is lost
 * over a long answer. A budget for each section is a count small enough to
 * keep.
 */

export interface SectionBudget {
  /** HOOK, or the beat's name as its heading carries it. */
  readonly section: string;
  readonly words: number;
}

export interface BudgetInput {
  /** The beat sheet as stored, one beat to a line; null when none is. */
  readonly beats: string | null;
  readonly targetSeconds: number | null;
  readonly targetWords: number | null;
  readonly hookWords: number | null;
}

export const HOOK_SECTION = 'HOOK';
const SECONDS_PER_MINUTE = 60;

/** A beat's start as seconds, from 1:30 or 1:02:30; null when it carries no time. */
function startOf(time: string): number | null {
  if (time === '') return null;
  return time
    .split(':')
    .map(Number)
    .reduce((seconds, part) => seconds * SECONDS_PER_MINUTE + part, 0);
}

/**
 * How long each beat runs, from one start to the next and from the last to
 * the end; null when a beat has no time, or the times do not climb to the end.
 */
function spans(starts: readonly (number | null)[], end: number | null): readonly number[] | null {
  if (end === null || starts.some((start) => start === null)) return null;
  const times = [...(starts as readonly number[]), end];
  const lengths = times.slice(1).map((time, at) => time - (times[at] ?? 0));
  return lengths.every((length) => length > 0) ? lengths : null;
}

/** Whole numbers in the given shares that add up to `total` exactly: largest remainders first. */
function shared(total: number, shares: readonly number[]): readonly number[] {
  const whole = shares.reduce((sum, share) => sum + share, 0);
  const exact = shares.map((share) => (total * share) / whole);
  const floors = exact.map(Math.floor);
  const left = total - floors.reduce((sum, words) => sum + words, 0);
  const byRemainder = exact
    .map((words, at) => ({ at, remainder: words - Math.floor(words) }))
    .sort((a, b) => b.remainder - a.remainder || a.at - b.at)
    .slice(0, left)
    .map((entry) => entry.at);
  return floors.map((words, at) => words + (byRemainder.includes(at) ? 1 : 0));
}

/**
 * The budget of a script, hook first; null until there is a length, a hook
 * length and a beat sheet, or when the hook would take the whole length.
 */
export function wordBudget(input: BudgetInput): readonly SectionBudget[] | null {
  const { targetWords, hookWords } = input;
  const beats = readBeats(input.beats ?? '');
  if (targetWords === null || hookWords === null || beats.length === 0) return null;
  const rest = targetWords - hookWords;
  if (hookWords < 1 || rest < beats.length) return null;
  const lengths =
    spans(
      beats.map((beat) => startOf(beat.time)),
      input.targetSeconds,
    ) ?? beats.map(() => 1);
  const words = shared(rest, lengths);
  return [
    { section: HOOK_SECTION, words: hookWords },
    ...beats.map((beat, at) => ({
      section: beat.name === '' ? `Beat ${at + 1}` : beat.name,
      words: words[at] ?? 0,
    })),
  ];
}

import { HEADING_LINE, countWords } from './measure';
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

/** A section of a script as written: its heading's name and its lines, heading first. */
interface WrittenSection {
  readonly name: string;
  readonly lines: readonly string[];
}

/** A script cut at its headings; what stands before the first heading belongs to no section. */
function sectionsOf(script: string): {
  readonly before: readonly string[];
  readonly sections: readonly WrittenSection[];
} {
  const before: string[] = [];
  const sections: { name: string; lines: string[] }[] = [];
  for (const line of script.split('\n')) {
    const current = sections.at(-1);
    if (HEADING_LINE.test(line.trim())) {
      sections.push({ name: line.trim().replace(HEADING_LINE, '').trim(), lines: [line] });
    } else if (current) current.lines.push(line);
    else before.push(line);
  }
  return { before, sections };
}

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** The spoken words under each heading of a script, in order. Cues and markers count for nothing. */
export function sectionWords(script: string): readonly SectionBudget[] {
  return sectionsOf(script).sections.map((section) => ({
    section: section.name,
    words: countWords(section.lines.join('\n')),
  }));
}

/** A section counts as short under this share of its number: a tenth is asked for, a little more is let go. */
export const SHORT_SECTION_SHARE = 0.85;

export interface ShortSection {
  /** The section's name as its heading in the script carries it. */
  readonly section: string;
  readonly words: number;
  readonly budget: number;
}

/**
 * The sections of a draft that came out short of their number. The hook is
 * the owner's own and is never one of them; a section whose name matches no
 * line of the budget is not judged.
 */
export function shortSections(
  script: string,
  budget: readonly SectionBudget[] | null,
): readonly ShortSection[] {
  if (budget === null) return [];
  return sectionWords(script).flatMap((written) => {
    const planned = budget.find((line) => sameName(line.section, written.section));
    if (!planned || sameName(written.section, HOOK_SECTION)) return [];
    return written.words < planned.words * SHORT_SECTION_SHARE
      ? [{ section: written.section, words: written.words, budget: planned.words }]
      : [];
  });
}

/** Lines without the empty ones at their end. */
function trimmedEnd(lines: readonly string[]): readonly string[] {
  const last = lines.findLastIndex((line) => line.trim() !== '');
  return lines.slice(0, last + 1);
}

/**
 * A script with some of its sections replaced by the ones of the same name
 * in `rewritten`. Only the sections named in `asked` are ever replaced, so
 * an answer that rewrites more than it was asked changes nothing else.
 */
export function replaceSections(
  script: string,
  rewritten: string,
  asked: readonly string[],
): { readonly script: string; readonly replaced: readonly string[] } {
  const fresh = sectionsOf(rewritten).sections.filter(
    (section) => countWords(section.lines.join('\n')) > 0,
  );
  const { before, sections } = sectionsOf(script);
  const replaced: string[] = [];
  const lines = sections.flatMap((section) => {
    const wanted = asked.some((name) => sameName(name, section.name));
    const found = wanted ? fresh.find((other) => sameName(other.name, section.name)) : undefined;
    if (!found) return section.lines;
    replaced.push(section.name);
    // The heading stays as the draft had it; the words under it are the new ones.
    return [section.lines[0] ?? '', ...trimmedEnd(found.lines.slice(1))];
  });
  return replaced.length === 0
    ? { script, replaced }
    : { script: [...before, ...lines].join('\n'), replaced };
}

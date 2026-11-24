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

/** A name as it is compared: one case, no punctuation, single spaces. */
const plain = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A number or a count word a heading may open with, before the name itself: "2.", "Beat 2:", "Two:". */
const NUMBERING =
  /^(?:(?:beat|part|section|chapter|act)\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*[:.)\-–]\s*/i;

/**
 * The ways a name may be read: as written, without a numbering before it,
 * and the part before or after a colon. An engine writing a draft often
 * heads a section "Two: The turn" or "The turn: what changed" for a beat
 * called "The turn".
 */
function readings(name: string): readonly string[] {
  const unnumbered = name.replace(NUMBERING, '');
  const [before = '', ...after] = unnumbered.split(':');
  return [...new Set([name, unnumbered, before, after.join(':')].map(plain))].filter(
    (reading) => reading !== '',
  );
}

/** Whether two names are the same name, read tolerantly. */
export const sameSection = (a: string, b: string): boolean => {
  const of = readings(b);
  return readings(a).some((reading) => of.includes(reading));
};

const isHook = (name: string): boolean => sameSection(name, HOOK_SECTION);

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
  /** The section's name: as its heading in the draft carries it, or the beat's name when it is missing. */
  readonly section: string;
  readonly words: number;
  readonly budget: number;
  /** The beat has no section in the draft at all. */
  readonly missing?: true;
}

export interface DraftCheck {
  /**
   * The draft's sections are not the beat sheet's beats: the sheet was
   * rewritten after the draft. Nothing is judged section by section then.
   */
  readonly stale: boolean;
  /** The sections under their share of the length, and the beats with no section, in beat order. */
  readonly short: readonly ShortSection[];
}

const NOT_CHECKED: DraftCheck = { stale: false, short: [] };

/**
 * Which section of the draft each beat of the budget is: by name, read
 * tolerantly, and, when the draft has exactly one section for every beat,
 * by place for those no name matched. Null for a beat with no section.
 */
function matched(
  beats: readonly SectionBudget[],
  written: readonly SectionBudget[],
): { readonly sections: readonly (SectionBudget | null)[]; readonly byName: number } {
  const taken = new Set<number>();
  const byName = beats.map((beat) => {
    const at = written.findIndex(
      (section, index) => !taken.has(index) && sameSection(section.section, beat.section),
    );
    if (at !== -1) taken.add(at);
    return at;
  });
  const sameCount = written.length === beats.length;
  const sections = byName.map((at, index) => {
    if (at !== -1) return written[at] ?? null;
    return sameCount && !taken.has(index) ? (written[index] ?? null) : null;
  });
  return { sections, byName: byName.filter((at) => at !== -1).length };
}

/**
 * A draft checked against its budget. It walks the budget, not the draft: a
 * beat with no section in the draft is reported as missing, where a check
 * that only read the headings written would never see it. The hook is the
 * owner's own and is never judged.
 */
export function checkDraft(script: string, budget: readonly SectionBudget[] | null): DraftCheck {
  if (budget === null || script.trim() === '') return NOT_CHECKED;
  const beats = budget.filter((line) => !isHook(line.section));
  const written = sectionWords(script).filter((section) => !isHook(section.section));
  if (beats.length === 0 || written.length === 0) return NOT_CHECKED;
  const { sections, byName } = matched(beats, written);
  const unmatched = sections.filter((section) => section === null).length;
  // Most beats have no section of their name, and the counts differ: another beat sheet's draft.
  if (unmatched > 0 && byName < beats.length / 2) return { stale: true, short: [] };
  const short = beats.flatMap((beat, at): ShortSection[] => {
    const section = sections[at];
    if (!section) return [{ section: beat.section, words: 0, budget: beat.words, missing: true }];
    return section.words < beat.words * SHORT_SECTION_SHARE
      ? [{ section: section.section, words: section.words, budget: beat.words }]
      : [];
  });
  return { stale: false, short };
}

/** The sections of a draft that came out short of their number, and the beats it has no section for. */
export const shortSections = (
  script: string,
  budget: readonly SectionBudget[] | null,
): readonly ShortSection[] => checkDraft(script, budget).short;

/** Lines without the empty ones at their end. */
function trimmedEnd(lines: readonly string[]): readonly string[] {
  const last = lines.findLastIndex((line) => line.trim() !== '');
  return lines.slice(0, last + 1);
}

/**
 * A script with some of its sections replaced by the ones of the same name
 * in `rewritten`, and the missing ones put in. Only the sections named in
 * `asked` are ever replaced or added, so an answer that rewrites more than
 * it was asked changes nothing else. A section the draft does not have is
 * put after the last section that comes before it in `order` (the beats, in
 * the order of the sheet), or right after the hook.
 */
export function replaceSections(
  script: string,
  rewritten: string,
  asked: readonly string[],
  order: readonly string[] = [],
): { readonly script: string; readonly replaced: readonly string[] } {
  const fresh = sectionsOf(rewritten).sections.filter(
    (section) => countWords(section.lines.join('\n')) > 0,
  );
  const freshFor = (name: string): WrittenSection | undefined =>
    asked.some((wanted) => sameSection(wanted, name))
      ? fresh.find((other) => sameSection(other.name, name))
      : undefined;
  const { before, sections } = sectionsOf(script);
  const replaced: string[] = [];
  const kept = sections.map((section): WrittenSection => {
    const found = freshFor(section.name);
    if (!found) return section;
    replaced.push(section.name);
    // The heading stays as the draft had it; the words under it are the new ones.
    return {
      name: section.name,
      lines: [section.lines[0] ?? '', ...trimmedEnd(found.lines.slice(1))],
    };
  });
  const added = asked
    .filter((name) => !sections.some((section) => sameSection(section.name, name)))
    .flatMap((name) => {
      const found = fresh.find((other) => sameSection(other.name, name));
      return found ? [{ name, lines: [`## ${name}`, ...trimmedEnd(found.lines.slice(1))] }] : [];
    });
  const placeOf = (name: string): number => order.findIndex((beat) => sameSection(beat, name));
  const all = added.reduce<readonly WrittenSection[]>((list, section) => {
    const place = placeOf(section.name);
    // After the last section that comes before it on the sheet; after the hook when none does.
    const after = list.findLastIndex((other) => {
      const at = placeOf(other.name);
      return isHook(other.name) || (at !== -1 && place !== -1 && at < place);
    });
    replaced.push(section.name);
    return [...list.slice(0, after + 1), section, ...list.slice(after + 1)];
  }, kept);
  return replaced.length === 0
    ? { script, replaced }
    : { script: [...before, ...all.flatMap((section) => section.lines)].join('\n'), replaced };
}

/**
 * The parts a channel breakdown is made of, and the lines that mark a ready
 * prompt inside one. The same for every channel.
 *
 * The first part is worked out by Jgtube in code: what the breakdown rests
 * on. The others are each written by an AI engine in a run of its own, in
 * this order, a later one reading the earlier ones through a read-only tool.
 */

/** The parts an AI engine writes, in the order they are written and read. */
export const BREAKDOWN_WRITTEN_PARTS = [
  'titles',
  'thumbnails',
  'scripts',
  'picture',
  'strategy',
  'plan',
  'master',
] as const;
/** What Jgtube works out itself before any engine writes: the videos studied and how. */
export const BREAKDOWN_BASIS_PART = 'basis';
/** Every part, in the order a breakdown is read. */
export const BREAKDOWN_PARTS = [BREAKDOWN_BASIS_PART, ...BREAKDOWN_WRITTEN_PARTS] as const;

export type BreakdownWrittenPart = (typeof BREAKDOWN_WRITTEN_PARTS)[number];
export type BreakdownPartId = (typeof BREAKDOWN_PARTS)[number];

export function isBreakdownPart(name: string): name is BreakdownPartId {
  return (BREAKDOWN_PARTS as readonly string[]).includes(name);
}

/** What each part is called where the owner reads it. */
export const BREAKDOWN_PART_TITLES: Readonly<Record<BreakdownPartId, string>> = {
  basis: 'What this rests on',
  titles: 'Titles',
  thumbnails: 'Thumbnails',
  scripts: 'Scripts',
  picture: 'Picture and sound',
  strategy: 'Strengths, weaknesses and strategy',
  plan: 'Production plan',
  master: 'Master prompt',
};

/**
 * The parts that hold a text for the owner to paste somewhere else (a ready
 * prompt, or the picture part's style lock), and the name each is marked by. A part is asked to put its prompt
 * between two fixed lines so that code can lift it out as it stands.
 */
export const PROMPT_MARKERS = {
  thumbnails: 'THUMBNAIL PROMPT',
  master: 'MASTER PROMPT',
  picture: 'STYLE LOCK',
} as const satisfies Partial<Record<BreakdownWrittenPart, string>>;
export type PromptMarker = (typeof PROMPT_MARKERS)[keyof typeof PROMPT_MARKERS];

/** The line that opens a marked prompt and the line that closes it. */
export function markerLines(name: string): { readonly start: string; readonly end: string } {
  return { start: `=== ${name} START ===`, end: `=== ${name} END ===` };
}

export interface MarkedText {
  /** What stood between the marker lines; null when it cannot be told for certain. */
  readonly marked: string | null;
  /** The text without the marked block and its marker lines; the whole text when nothing was found. */
  readonly rest: string;
}

/**
 * Lifts a marked prompt out of a part. It is found only when the text holds
 * exactly one opening line and exactly one closing line after it, each on a
 * line of its own, with something between them. Anything else gives nothing:
 * a prompt is never guessed at.
 */
export function splitMarked(text: string, name: string): MarkedText {
  const { start, end } = markerLines(name);
  const lines = text.split(/\r?\n/);
  const at = (marker: string): readonly number[] =>
    lines.flatMap((line, index) => (line.trim() === marker ? [index] : []));
  const [starts, ends] = [at(start), at(end)];
  const [from, to] = [starts[0], ends[0]];
  if (starts.length !== 1 || ends.length !== 1 || from === undefined || to === undefined) {
    return { marked: null, rest: text };
  }
  const marked = lines
    .slice(from + 1, to)
    .join('\n')
    .trim();
  if (to < from || marked === '') return { marked: null, rest: text };
  const before = lines.slice(0, from).join('\n').trimEnd();
  const after = lines
    .slice(to + 1)
    .join('\n')
    .trim();
  return { marked, rest: [before, after].filter((piece) => piece !== '').join('\n\n') };
}

import { readBlocks, single, type LabelledBlock } from '../labelled';
import type { ConceptFields } from './types';

/**
 * Reads the concepts out of an engine's answer. The engine is asked for a
 * fixed form: a heading "CONCEPT 1" and under it TITLE, ALT (twice),
 * THUMBNAIL, OVERLAY, HOOK, RESTS ON and NEEDS, one to a line, and HOOK STYLE
 * when its opening follows the way of a hook in the library.
 *
 * The reading is strict. A concept with a part missing, given twice or far
 * too long is counted as unread and left out: no part is ever guessed, cut to
 * fit or borrowed from a neighbour.
 */

/** How many concepts a first batch asks for. */
export const CONCEPTS_PER_BATCH = 10;
/** A different angle on one subject: a few to choose from, not another batch. */
export const TWIST_CONCEPTS = 3;
/** Other subjects in the same vein as one concept. */
export const MORE_CONCEPTS = 5;

/** YouTube takes no title longer than this, so a longer one could not be used as written. */
export const MAX_TITLE_CHARS = 100;
/**
 * How many characters of a title a phone's feed shows before cutting it with
 * an ellipsis. YouTube publishes no such number, only its hard limit of 100.
 * Title-checking tools put the cut between 45 and 60 characters, depending on
 * how wide the letters are; 55 is used here as the point to warn from.
 */
export const PHONE_TITLE_CHARS = 55;
/** The same for a Short, whose feed shows less: those tools give about 40. */
export const SHORTS_TITLE_CHARS = 40;
/** The overlay is asked for in four words or fewer; this is the room for four long ones. */
const MAX_OVERLAY_CHARS = 60;
/** One sentence; anything this long is not one. */
const MAX_HOOK_CHARS = 500;
/** A thumbnail brief is two or three sentences. */
const MAX_THUMBNAIL_CHARS = 900;
/**
 * The words asked for at most in a rests-on line and in a needs line, and the
 * room that many take with a margin: a real run gave needs lines of up to
 * 400 characters, and a line cut off for being a little long loses a concept.
 */
export const MAX_LINE_WORDS = 80;
const MAX_RESTS_ON_CHARS = 1200;
const MAX_NEEDS_CHARS = 1200;

const MAX_HOOK_STYLE_CHARS = 120;

const LABELS = [
  'TITLE',
  'ALT',
  'THUMBNAIL',
  'OVERLAY',
  'HOOK',
  'HOOK STYLE',
  'RESTS ON',
  'NEEDS',
] as const;
/** "CONCEPT 3", "3. CONCEPT" or "CONCEPT 3:" on a line of its own. */
const HEADING = /^(?:\d{1,2}[.)]\s*)?CONCEPT(?:\s+\d{1,2})?\s*:?$/;
const ALTERNATES = 2;

export interface ParsedConcepts {
  /** The concepts that could be read, in the order they were written. */
  readonly concepts: readonly ConceptFields[];
  /** How many more the answer held that could not be read. */
  readonly unread: number;
  /** Why each of those could not be read: a reason worked out here, never the engine's words. */
  readonly problems: readonly string[];
}

/**
 * The hook-style line when it names something. The line is optional: a
 * concept that follows no library hook, or says "none", has none.
 */
function hookStyleOf(block: LabelledBlock): string | null {
  const style = single(block, 'HOOK STYLE');
  if (style === null || style.length > MAX_HOOK_STYLE_CHARS) return null;
  return NOTHING.test(style.trim()) ? null : style;
}

/** The parts every concept must have, with what each is called and how long it may be. */
const REQUIRED = [
  ['TITLE', 'title', MAX_TITLE_CHARS],
  ['THUMBNAIL', 'thumbnail brief', MAX_THUMBNAIL_CHARS],
  ['OVERLAY', 'overlay text', MAX_OVERLAY_CHARS],
  ['HOOK', 'hook', MAX_HOOK_CHARS],
  ['RESTS ON', 'rests-on line', MAX_RESTS_ON_CHARS],
  ['NEEDS', 'needs line', MAX_NEEDS_CHARS],
] as const;

/** Why a block is not a concept, in plain words, or null when every part is there and fits. */
function problemOf(block: LabelledBlock): string | null {
  for (const [label, name, max] of REQUIRED) {
    const texts = block.get(label) ?? [];
    if (texts.length > 1) return `its ${name} was given ${texts.length} times`;
    const text = single(block, label);
    if (text === null) return `it has no ${name}`;
    if (text.length > max) return `its ${name} is longer than ${max} characters`;
  }
  const alternates = (block.get('ALT') ?? []).filter((title) => title !== '');
  if (alternates.length < ALTERNATES) return 'it has fewer than two alternate titles';
  return alternates.slice(0, ALTERNATES).some((title) => title.length > MAX_TITLE_CHARS)
    ? `an alternate title is longer than ${MAX_TITLE_CHARS} characters`
    : null;
}

/** One block as a concept. Only called for a block `problemOf` found nothing wrong with. */
function conceptOf(block: LabelledBlock): ConceptFields {
  const part = (label: string): string => single(block, label) ?? '';
  const [first = '', second = ''] = (block.get('ALT') ?? []).filter((title) => title !== '');
  return {
    title: part('TITLE'),
    altTitles: [first, second],
    thumbnail: part('THUMBNAIL'),
    overlay: part('OVERLAY'),
    hook: part('HOOK'),
    hookStyle: hookStyleOf(block),
    restsOn: part('RESTS ON'),
    needs: part('NEEDS'),
  };
}

/**
 * The concepts in an answer, at most `limit` of them. `unread` counts the
 * concepts the answer set out that could not be read, and `problems` says
 * why, one plain reason for each.
 */
export function parseConcepts(answer: string, limit: number): ParsedConcepts {
  const blocks = readBlocks(answer, { labels: LABELS, opens: (line) => HEADING.test(line) });
  const judged = blocks.map((block) => ({ block, problem: problemOf(block) }));
  const problems = judged.flatMap(({ problem }) => (problem === null ? [] : [problem]));
  const concepts = judged
    .filter(({ problem }) => problem === null)
    .map(({ block }) => conceptOf(block));
  return { concepts: concepts.slice(0, limit), unread: problems.length, problems };
}

/** What an engine writes when there is nothing to name. */
const NOTHING = /^(?:nothing|none)\.?$/i;

const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One plain sentence for a batch that came back short, or null when every
 * concept asked for was read. A short batch is still shown.
 */
export function batchNote(asked: number, read: number, unread: number): string | null {
  if (read >= asked) return null;
  if (unread === 0) return `The AI returned ${count(read, 'concept')}, not the ${asked} asked for.`;
  return (
    `The AI returned ${count(read, 'concept')} that could be read, not the ${asked} asked for. ` +
    `${unread} more ${unread === 1 ? 'was' : 'were'} left out because a part was missing or too long.`
  );
}

/**
 * The picked videos a rests-on line names, in the order they were picked.
 * Only ids the owner picked count: an id the engine made up names nothing.
 */
export function namedVideoIds(restsOn: string, picked: readonly string[]): readonly string[] {
  const mentioned = new Set(restsOn.match(/(?<![\w-])[\w-]{11}(?![\w-])/g) ?? []);
  return picked.filter((id) => mentioned.has(id));
}

/** Whether a needs line names something to look up before the video is made. */
export function needsSomething(needs: string): boolean {
  return !NOTHING.test(needs.trim());
}

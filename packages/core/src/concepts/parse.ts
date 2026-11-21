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
/** The overlay is asked for in four words or fewer; this is the room for four long ones. */
const MAX_OVERLAY_CHARS = 60;
/** One sentence; anything this long is not one. */
const MAX_HOOK_CHARS = 400;
/** A thumbnail brief is two or three sentences. */
const MAX_THUMBNAIL_CHARS = 700;
/** Up to five picked videos with a few words on each. */
const MAX_RESTS_ON_CHARS = 900;
const MAX_NEEDS_CHARS = 500;

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
}

const within = (text: string | null, max: number): string | null =>
  text !== null && text.length <= max ? text : null;

/**
 * The hook-style line when it names something. The line is optional: a
 * concept that follows no library hook, or says "none", has none.
 */
function hookStyleOf(block: LabelledBlock): string | null {
  const style = within(single(block, 'HOOK STYLE'), MAX_HOOK_STYLE_CHARS);
  return style === null || NOTHING.test(style.trim()) ? null : style;
}

/** One block as a concept, or null when any part is missing, doubled or too long. */
function conceptOf(block: LabelledBlock): ConceptFields | null {
  const alternates = (block.get('ALT') ?? []).slice(0, ALTERNATES);
  const [first, second] = alternates.map((title) => within(title, MAX_TITLE_CHARS));
  const fields = {
    title: within(single(block, 'TITLE'), MAX_TITLE_CHARS),
    thumbnail: within(single(block, 'THUMBNAIL'), MAX_THUMBNAIL_CHARS),
    overlay: within(single(block, 'OVERLAY'), MAX_OVERLAY_CHARS),
    hook: within(single(block, 'HOOK'), MAX_HOOK_CHARS),
    restsOn: within(single(block, 'RESTS ON'), MAX_RESTS_ON_CHARS),
    needs: within(single(block, 'NEEDS'), MAX_NEEDS_CHARS),
  };
  const { title, thumbnail, overlay, hook, restsOn, needs } = fields;
  if (!title || !thumbnail || !overlay || !hook || !restsOn || !needs) return null;
  if (!first || !second) return null;
  return {
    title,
    altTitles: [first, second],
    thumbnail,
    overlay,
    hook,
    hookStyle: hookStyleOf(block),
    restsOn,
    needs,
  };
}

/**
 * The concepts in an answer, at most `limit` of them. `unread` counts the
 * concepts the answer set out that could not be read.
 */
export function parseConcepts(answer: string, limit: number): ParsedConcepts {
  const blocks = readBlocks(answer, { labels: LABELS, opens: (line) => HEADING.test(line) });
  const read = blocks.map(conceptOf);
  const concepts = read.filter((concept): concept is ConceptFields => concept !== null);
  return { concepts: concepts.slice(0, limit), unread: read.length - concepts.length };
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

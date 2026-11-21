import { readAnswer, readSections, type AnswerBlock, type AnswerSection } from './analyses';
import { namedIds, withoutRefs } from './videoRefs';

/**
 * A long AI answer set out to be read: what it says in short first, then
 * each section on its own card with its first points showing and the rest
 * behind a disclosure. Only the grouping is worked out here; the words stay
 * the engine's, shown as text.
 */

/** How many points of a section show before "More". */
export const POINTS_SHOWN = 3;

/** The most characters of a part's opening line shown before it is opened. */
const LEAD_MAX_CHARS = 220;

export interface AnswerOutline {
  /** What the answer opens with before its first heading; empty when it opens on a heading. */
  readonly summary: readonly AnswerBlock[];
  /** The titled sections, in order. */
  readonly sections: readonly AnswerSection[];
}

/** The answer split into its opening summary and its titled sections. */
export function outlineOf(text: string): AnswerOutline {
  const sections = readSections(text);
  const [first] = sections;
  if (first && first.title === null) {
    return { summary: first.blocks, sections: sections.slice(1) };
  }
  return { summary: [], sections };
}

export interface SplitBlocks {
  readonly shown: readonly AnswerBlock[];
  readonly more: readonly AnswerBlock[];
}

/**
 * A section's points: the first few to show, and the rest for "More". A
 * single point left over is shown too, as a disclosure for one line only
 * adds a press.
 */
export function splitBlocks(
  blocks: readonly AnswerBlock[],
  shown: number = POINTS_SHOWN,
): SplitBlocks {
  if (blocks.length <= shown + 1) return { shown: blocks, more: [] };
  return { shown: blocks.slice(0, shown), more: blocks.slice(shown) };
}

/** "More (n)" for the points behind a section's disclosure. */
export const moreLabel = (count: number): string =>
  `${count} more ${count === 1 ? 'point' : 'points'}`;

/**
 * The opening of a long text in one line or two, for a card that is closed:
 * its first paragraph or point, without video markers, cut at a word.
 * Null when the text holds no words to show.
 */
export function leadOf(text: string): string | null {
  const block = readAnswer(text).find((entry) => entry.kind !== 'heading');
  if (!block) return null;
  const words = withoutRefs(block.text);
  if (words === '') return null;
  if (words.length <= LEAD_MAX_CHARS) return words;
  const cut = words.slice(0, LEAD_MAX_CHARS);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[.,;:]$/, '')}…`;
}

/**
 * The summary left to show under a lead already on screen: without its
 * first block when the lead said all of it, that is when the block is short
 * enough not to be cut and names no video whose thumbnail would be lost.
 */
export function summaryAfterLead(summary: readonly AnswerBlock[]): readonly AnswerBlock[] {
  const [first] = summary;
  if (!first || namedIds(first.text).length > 0) return summary;
  return withoutRefs(first.text).length <= LEAD_MAX_CHARS ? summary.slice(1) : summary;
}

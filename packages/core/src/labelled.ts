/**
 * Reads an engine's plain-text answer that was asked for in a fixed labelled
 * form: blocks, each a run of "LABEL: text" lines. It only reads what is
 * there: a part that is missing stays missing, and it is for the caller to
 * decide what a block without it is worth.
 *
 * Engines are asked for plain text and sometimes add marks anyway (a "#"
 * before a heading, "**" around a label, "- " before a line). Those are
 * looked through. Nothing in the text is ever treated as markup or acted on.
 */

/** Each label of one block with the texts given under it, in the order they came. */
export type LabelledBlock = ReadonlyMap<string, readonly string[]>;

export interface BlockRules {
  /** The labels that may open a line, in capitals, without the colon. */
  readonly labels: readonly string[];
  /** Whether a line, cleared of marks, opens a new block. */
  readonly opens: (line: string) => boolean;
}

const LIST_MARK = /^[-*•]\s+/;
const HEADING_MARK = /^#+\s*/;
/**
 * Emphasis and code marks, wherever they stand. Underscores are left alone:
 * a video id may hold two in a row.
 */
const INLINE_MARKS = /\*\*|`/g;

/** A line without the marks an engine may have put around it. */
export function unmarked(line: string): string {
  return line
    .trim()
    .replace(HEADING_MARK, '')
    .replace(LIST_MARK, '')
    .replace(INLINE_MARKS, '')
    .trim();
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches a line that starts with one of the labels and a colon; the rest is its text. */
function labelPattern(labels: readonly string[]): RegExp {
  // Longest first, so "RESTS ON" is not read as a shorter label that starts the same way.
  const names = [...labels].sort((a, b) => b.length - a.length).map(escaped);
  return new RegExp(`^(${names.join('|')})\\s*:\\s*(.*)$`);
}

interface Reading {
  readonly blocks: readonly LabelledBlock[];
  /** The label whose text a following line would continue; null when none is open. */
  readonly open: string | null;
}

const lastOf = (blocks: readonly LabelledBlock[]): LabelledBlock => blocks.at(-1) ?? new Map();

/** The blocks with the last one replaced. */
const withLast = (
  blocks: readonly LabelledBlock[],
  last: LabelledBlock,
): readonly LabelledBlock[] => [...blocks.slice(0, -1), last];

function withField(block: LabelledBlock, label: string, text: string): LabelledBlock {
  return new Map([...block, [label, [...(block.get(label) ?? []), text]]]);
}

/** The block with `more` added to the end of the last text under `label`. */
function continued(block: LabelledBlock, label: string, more: string): LabelledBlock {
  const texts = block.get(label) ?? [];
  const joined = [texts.at(-1) ?? '', more].filter((part) => part !== '').join(' ');
  return new Map([...block, [label, [...texts.slice(0, -1), joined]]]);
}

/**
 * The blocks of an answer. A line that opens a block starts a new one; a
 * labelled line adds its text to the block it is in; a line right under a
 * labelled line, with no blank line between, continues that text. Anything
 * before the first block, and any line that stands alone, is left out.
 */
export function readBlocks(answer: string, rules: BlockRules): readonly LabelledBlock[] {
  const pattern = labelPattern(rules.labels);
  const step = (reading: Reading, raw: string): Reading => {
    const line = unmarked(raw);
    const blocks = rules.opens(line) ? [...reading.blocks, new Map()] : reading.blocks;
    const [, label, text] = pattern.exec(line) ?? [];
    if (label !== undefined && blocks.length > 0) {
      const block = withField(lastOf(blocks), label, (text ?? '').trim());
      return { blocks: withLast(blocks, block), open: label };
    }
    if (line === '' || blocks !== reading.blocks || reading.open === null) {
      return { blocks, open: null };
    }
    return {
      blocks: withLast(blocks, continued(lastOf(blocks), reading.open, line)),
      open: reading.open,
    };
  };
  return answer.split('\n').reduce(step, { blocks: [], open: null }).blocks;
}

/** The one text under a label; null when the block has none, several, or an empty one. */
export function single(block: LabelledBlock, label: string): string | null {
  const texts = block.get(label) ?? [];
  const [only] = texts;
  return texts.length === 1 && only !== undefined && only !== '' ? only : null;
}

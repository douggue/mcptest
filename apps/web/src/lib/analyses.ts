/** The analyses Claude can run from the screen; the ids are the server's. */
export type AnalysisId = 'thumbnails' | 'topics' | 'near-misses';

export interface AnalysisOption {
  readonly id: AnalysisId;
  readonly title: string;
  /** One sentence saying what pressing the button gives. */
  readonly description: string;
  /** The button's label. */
  readonly action: string;
}

export const ANALYSIS_OPTIONS: readonly AnalysisOption[] = [
  {
    id: 'thumbnails',
    title: 'Thumbnail review',
    description:
      'Claude looks at the thumbnails that took off on channels like yours, and at yours, and says what to change.',
    action: 'Review my thumbnails',
  },
  {
    id: 'topics',
    title: 'Video ideas',
    description:
      'Claude reads the breakouts around your channel and proposes videos to make next, with the evidence for each.',
    action: 'Suggest video ideas',
  },
  {
    id: 'near-misses',
    title: 'Same topic, different words',
    description:
      'Claude reads the titles of channels the filter left out for their wording and says which really make your kind of video.',
    action: 'Judge the near misses',
  },
];

export interface AnswerBlock {
  readonly kind: 'heading' | 'item' | 'paragraph';
  readonly text: string;
}

const LIST_MARK = /^[-*•]\s+/;
const HEADING_MARK = /^#+\s+/;
/** Emphasis and code marks, which Claude is asked not to use but sometimes does. */
const INLINE_MARKS = /\*\*|`/g;
/** A line in capitals, optionally numbered: how Claude is asked to write section titles. */
const CAPITALS_LINE = /^(\d+\.\s+)?[A-Z0-9][A-Z0-9 ,'’&/:()-]*$/;
const MIN_HEADING_LETTERS = 3;

const clean = (text: string): string => text.replace(INLINE_MARKS, '').trim();

function isHeading(line: string): boolean {
  if (HEADING_MARK.test(line)) return true;
  const letters = line.replace(/[^A-Za-z]/g, '').length;
  return letters >= MIN_HEADING_LETTERS && CAPITALS_LINE.test(line);
}

/**
 * Breaks Claude's plain-text answer into headings, list items and paragraphs
 * so the screen can set them out. The text is only ever shown as text; nothing
 * in it is treated as markup.
 */
export function readAnswer(answer: string): readonly AnswerBlock[] {
  let blocks: readonly AnswerBlock[] = [];
  let paragraph: readonly string[] = [];
  const endParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks = [...blocks, { kind: 'paragraph', text: paragraph.join(' ') }];
    }
    paragraph = [];
  };

  for (const raw of answer.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      endParagraph();
    } else if (LIST_MARK.test(line)) {
      endParagraph();
      blocks = [...blocks, { kind: 'item', text: clean(line.replace(LIST_MARK, '')) }];
    } else if (isHeading(line)) {
      endParagraph();
      blocks = [...blocks, { kind: 'heading', text: clean(line.replace(HEADING_MARK, '')) }];
    } else {
      paragraph = [...paragraph, clean(line)];
    }
  }
  endParagraph();
  return blocks;
}

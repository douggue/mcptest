/** The analyses an AI engine can run from the screen; the ids are the server's. */
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
      'Looks at the thumbnails that took off on channels like yours, and at yours, and says what to change.',
    action: 'Review my thumbnails',
  },
  {
    id: 'topics',
    title: 'Video ideas',
    description:
      'Reads the breakouts around your channel and proposes videos to make next, with the evidence for each.',
    action: 'Suggest video ideas',
  },
  {
    id: 'near-misses',
    title: 'Same topic, different words',
    description:
      'Reads the titles of channels the filter left out for their wording and says which really make your kind of video.',
    action: 'Judge the near misses',
  },
];

/** The AI engines that answer with Jgtube's tools; the ids are the server's. */
export type EngineId = 'agy' | 'claude' | 'codex';
/** Every engine, including the web service that only watches video. */
export type AnyEngineId = EngineId | 'gemini-api';

/** What the server knows about one engine on this computer. */
export interface EngineStatus {
  readonly id: AnyEngineId;
  readonly label: string;
  readonly installed: boolean;
  /** Null when it cannot be told without asking the engine a question. */
  readonly signedIn: boolean | null;
  readonly version: string | null;
  /** Whether Jgtube would use it. */
  readonly ready: boolean;
  readonly note: string | null;
}

export interface EngineReport {
  readonly engines: readonly EngineStatus[];
  /** The order the engines are tried in. */
  readonly order: readonly EngineId[];
}

/** An engine that was passed over, and the reason in plain words. */
export interface SkippedEngine {
  readonly engine: AnyEngineId;
  readonly reason: string;
  readonly message: string;
}

export interface AnalysisAnswer {
  readonly text: string;
  /** The engine that answered; null when the server did not say. */
  readonly engine: EngineId | null;
  readonly skipped: readonly SkippedEngine[];
}

/** The names a creator knows the engines by. */
const ENGINE_NAMES: Readonly<Record<AnyEngineId, string>> = {
  agy: 'Antigravity',
  claude: 'Claude Code',
  codex: 'Codex',
  'gemini-api': 'Gemini API',
};

const nameOf = (id: AnyEngineId): string => ENGINE_NAMES[id];

function stateOf(status: EngineStatus): string {
  if (!status.installed) return 'not installed';
  if (status.signedIn === false) return 'not signed in';
  return status.ready ? 'ready' : 'needs setting up';
}

/**
 * One quiet line saying which engines are available, in the order they are
 * tried. Empty until the server has said.
 */
export function engineSummary(report: EngineReport | null): string {
  if (report === null) return '';
  const find = (id: AnyEngineId) => report.engines.find((status) => status.id === id);
  const tried = report.order.flatMap((id) => {
    const status = find(id);
    return status ? [`${nameOf(id)}: ${stateOf(status)}`] : [];
  });
  const gemini = find('gemini-api');
  const video = gemini
    ? [`${nameOf('gemini-api')}, for watching video: ${gemini.installed ? 'key set' : 'no key'}`]
    : [];
  return [...tried, ...video].join(' · ');
}

/** Who answered, and which engines were passed over on the way. Empty when the server did not say. */
export function answerCredit({ engine, skipped }: AnalysisAnswer): string {
  if (engine === null) return '';
  const answered = `Answered by ${nameOf(engine)}.`;
  if (skipped.length === 0) return answered;
  const names = skipped.map((entry) => nameOf(entry.engine));
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${answered} ${list} ${names.length === 1 ? 'was' : 'were'} passed over.`;
}

/** Why each engine was passed over, one line each: these often say what the owner can do about it. */
export const skippedNotes = (skipped: readonly SkippedEngine[]): readonly string[] =>
  skipped.map((entry) => `${nameOf(entry.engine)}: ${entry.message}`);

export interface AnswerBlock {
  readonly kind: 'heading' | 'item' | 'paragraph';
  readonly text: string;
}

const LIST_MARK = /^[-*•]\s+/;
const HEADING_MARK = /^#+\s+/;
/** Emphasis and code marks, which the engine is asked not to use but sometimes does. */
const INLINE_MARKS = /\*\*|`/g;
/** A line in capitals, optionally numbered: how the engine is asked to write section titles. */
const CAPITALS_LINE = /^(\d+\.\s+)?[A-Z0-9][A-Z0-9 ,'’&/:()-]*$/;
const MIN_HEADING_LETTERS = 3;

const clean = (text: string): string => text.replace(INLINE_MARKS, '').trim();

function isHeading(line: string): boolean {
  if (HEADING_MARK.test(line)) return true;
  const letters = line.replace(/[^A-Za-z]/g, '').length;
  return letters >= MIN_HEADING_LETTERS && CAPITALS_LINE.test(line);
}

/**
 * Breaks an engine's plain-text answer into headings, list items and paragraphs
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

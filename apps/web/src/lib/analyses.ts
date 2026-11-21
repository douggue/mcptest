import type { NamedVideo } from './videoRefs';

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

/** Letting Jgtube pick: the main engine first, the others as backups. */
export const AUTOMATIC = 'auto';
/** Which AI the owner wants an analysis from. */
export type EngineChoice = typeof AUTOMATIC | EngineId;

export interface ChoiceOption {
  readonly choice: EngineChoice;
  readonly label: string;
}

/** The switch, in the order it is shown. */
export const ENGINE_CHOICES: readonly ChoiceOption[] = [
  { choice: AUTOMATIC, label: 'Automatic' },
  { choice: 'claude', label: 'Claude Code' },
  { choice: 'agy', label: 'Antigravity' },
  { choice: 'codex', label: 'Codex' },
];

/** A remembered choice as read back from the browser; anything unknown is Automatic. */
export const choiceFrom = (text: string | null): EngineChoice =>
  ENGINE_CHOICES.find((option) => option.choice === text)?.choice ?? AUTOMATIC;

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
  /** The ready prompt lifted out of the answer (a thumbnail review ends with one); null when none. */
  readonly prompt: string | null;
  /** The stored videos of this map the answer names, so their thumbnails can be shown. */
  readonly videos: readonly NamedVideo[];
  /** When the answer was kept for the channel; null when it was not. */
  readonly writtenAt: string | null;
}

/** The names a creator knows the engines by. */
const ENGINE_NAMES: Readonly<Record<AnyEngineId, string>> = {
  agy: 'Antigravity',
  claude: 'Claude Code',
  codex: 'Codex',
  'gemini-api': 'Gemini API',
};

/** An engine by the name a creator knows it by. */
export const engineName = (id: AnyEngineId): string => ENGINE_NAMES[id];
const nameOf = engineName;

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

/**
 * One line under the switch saying what the choice means, and, for a chosen
 * engine the server says is not usable, what is in the way.
 */
export function choiceHelp(choice: EngineChoice, report: EngineReport | null): string {
  if (choice === AUTOMATIC) {
    const [main, ...backups] = (report?.order ?? []).map(nameOf);
    if (main === undefined)
      return 'Jgtube picks the AI, and tries the next one if it cannot answer.';
    return backups.length === 0
      ? `${main} answers.`
      : `${main} answers. If it cannot, ${backups.join(' and then ')} ${backups.length === 1 ? 'is' : 'are'} tried.`;
  }
  const name = nameOf(choice);
  const status = report?.engines.find((entry) => entry.id === choice);
  if (report !== null && !report.order.includes(choice)) {
    return `${name} is switched off in the settings file (JGTUBE_ENGINES).`;
  }
  if (status && !status.ready) {
    return `${name} is ${stateOf(status)} on this computer${status.note ? `. ${status.note}` : '.'}`;
  }
  const pictures = choice === 'agy' ? ' The thumbnail review needs Claude Code or Codex.' : '';
  return `Only ${name} answers; nothing else is tried if it cannot.${pictures}`;
}

/** Who answered, and which engines were passed over on the way. Empty when the server did not say. */
export function answerCredit({
  engine,
  skipped,
}: Pick<AnalysisAnswer, 'engine' | 'skipped'>): string {
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

export type AnswerBlock =
  | { readonly kind: 'heading' | 'item' | 'paragraph'; readonly text: string }
  /** A line that names what it holds, such as "WHY: two channels made it". */
  | { readonly kind: 'field'; readonly label: string; readonly text: string };

/** The blocks under one heading. `numbered` marks an entry in a list of them, such as one video idea. */
export interface AnswerSection {
  readonly title: string | null;
  readonly numbered: boolean;
  readonly blocks: readonly AnswerBlock[];
}

const LIST_MARK = /^[-*•]\s+/;
const HEADING_MARK = /^#+\s+/;
/** Emphasis and code marks, which the engine is asked not to use but sometimes does. */
const INLINE_MARKS = /\*\*|`/g;
/** A line in capitals, optionally numbered: how the engine is asked to write section titles. */
const CAPITALS_LINE = /^(\d+\.\s+)?[A-Z0-9][A-Z0-9 ,'’&/:()-]*$/;
const MIN_HEADING_LETTERS = 3;
/** A label in capitals, a colon, then what it holds: how the engine is asked to set out an entry. */
const FIELD_LINE = /^([A-Z][A-Z' ]{1,39}):\s+(\S.*)$/;
const NUMBERED = /^\d+\.\s/;

const clean = (text: string): string => text.replace(INLINE_MARKS, '').trim();

function isHeading(line: string): boolean {
  if (HEADING_MARK.test(line)) return true;
  const letters = line.replace(/[^A-Za-z]/g, '').length;
  return letters >= MIN_HEADING_LETTERS && CAPITALS_LINE.test(line);
}

/** The line as a field when it is a label in capitals and what it holds, else null. */
function labelled(line: string): AnswerBlock | null {
  const [, label, text] = FIELD_LINE.exec(clean(line)) ?? [];
  return label && text ? { kind: 'field', label: label.trim(), text } : null;
}

const item = (line: string): AnswerBlock => ({
  kind: 'item',
  text: clean(line.replace(LIST_MARK, '')),
});

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
      blocks = [...blocks, labelled(line.replace(LIST_MARK, '')) ?? item(line)];
    } else if (labelled(line) !== null) {
      endParagraph();
      blocks = [...blocks, labelled(line) ?? item(line)];
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

/**
 * The same blocks grouped under their headings, so the screen can set each
 * part out on its own. What comes before the first heading is an untitled
 * section.
 */
export function readSections(answer: string): readonly AnswerSection[] {
  let sections: readonly AnswerSection[] = [];
  for (const block of readAnswer(answer)) {
    if (block.kind === 'heading') {
      sections = [
        ...sections,
        { title: block.text, numbered: NUMBERED.test(block.text), blocks: [] },
      ];
      continue;
    }
    const last = sections.at(-1) ?? { title: null, numbered: false, blocks: [] };
    const before = sections.length === 0 ? sections : sections.slice(0, -1);
    sections = [...before, { ...last, blocks: [...last.blocks, block] }];
  }
  return sections;
}

/** An answer kept for the channel on screen, with the analysis it answers. */
export interface KeptAnswer {
  readonly analysis: AnalysisId;
  readonly answer: AnalysisAnswer;
}

const timeOf = (answer: AnalysisAnswer): number =>
  answer.writtenAt === null ? Number.NaN : new Date(answer.writtenAt).getTime();

/** The answers that are kept, each with its analysis; an analysis with none is left out. */
export const keptOnly = (
  entries: readonly { readonly analysis: AnalysisId; readonly answer: AnalysisAnswer | null }[],
): readonly KeptAnswer[] =>
  entries.flatMap(({ analysis, answer }) => (answer === null ? [] : [{ analysis, answer }]));

/** Of the answers kept for a channel, the one written last; null when none has a time. */
export function latestKept(
  entries: readonly { readonly analysis: AnalysisId; readonly answer: AnalysisAnswer | null }[],
): KeptAnswer | null {
  const dated = entries.flatMap(({ analysis, answer }) =>
    answer !== null && !Number.isNaN(timeOf(answer)) ? [{ analysis, answer }] : [],
  );
  return dated.reduce<KeptAnswer | null>(
    (best, entry) => (best === null || timeOf(entry.answer) > timeOf(best.answer) ? entry : best),
    null,
  );
}

const day = (date: Date): string => date.toLocaleDateString(undefined, { dateStyle: 'medium' });

/** One quiet line saying a shown answer was kept from an earlier run; empty with no time. */
export function keptLine(writtenAt: string | null, format: (date: Date) => string = day): string {
  if (writtenAt === null) return '';
  const at = new Date(writtenAt);
  return Number.isNaN(at.getTime()) ? '' : `Kept from ${format(at)}.`;
}

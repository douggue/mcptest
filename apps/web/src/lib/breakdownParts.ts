import type { EngineId, SkippedEngine } from './analyses';
import { engineName } from './breakdown';

/**
 * A stored breakdown as the page reads it: its parts, the four texts there
 * are to download, and how writing each part went. The shapes are the
 * server's; what is said about them to the owner is worked out here.
 */

/** The parts of a breakdown, in the order they are read; the ids are the server's. */
export type BreakdownPartId =
  'basis' | 'titles' | 'thumbnails' | 'scripts' | 'picture' | 'strategy' | 'plan' | 'master';
export type BreakdownWrittenPart = Exclude<BreakdownPartId, 'basis'>;

export interface BreakdownPartView {
  readonly id: BreakdownPartId;
  readonly title: string;
  readonly state: 'written' | 'failed' | 'missing';
  /** The part's text without the prompt it marks; empty when the part is not written. */
  readonly body: string;
  /** The ready prompt lifted out of the part; null when it holds none. */
  readonly prompt: string | null;
  readonly engine: string | null;
  readonly writtenAt: string | null;
  readonly reason: string | null;
}

export type BreakdownFileId = 'whole' | 'plan' | 'thumbnail' | 'master';

export interface BreakdownFileView {
  readonly id: BreakdownFileId;
  readonly name: string;
  readonly available: boolean;
  readonly reason: string | null;
}

export interface BreakdownView {
  readonly channel: { readonly id: string; readonly title: string };
  readonly writtenAt: string | null;
  readonly parts: readonly BreakdownPartView[];
  readonly files: readonly BreakdownFileView[];
  /** The folder the text files were saved in; null when they are not on disk. */
  readonly folder: string | null;
}

/** How writing one part went in a run. */
export type PartRun = {
  readonly part: BreakdownWrittenPart;
  readonly seconds: number;
} & (
  | {
      readonly outcome: 'written';
      readonly engine: EngineId;
      readonly skipped: readonly SkippedEngine[];
    }
  | { readonly outcome: 'kept'; readonly engine: string }
  | { readonly outcome: 'failed'; readonly reason: string }
);

const PART_TITLES: Readonly<Record<BreakdownWrittenPart, string>> = {
  titles: 'Titles',
  thumbnails: 'Thumbnails',
  scripts: 'Scripts',
  picture: 'Picture and sound',
  strategy: 'Strengths, weaknesses and strategy',
  plan: 'Production plan',
  master: 'Master prompt',
};

/** Who wrote the part that is worked out in code. */
const JGTUBE = 'jgtube';
const MINUTE_SECONDS = 60;

/** A time as the owner's computer writes it: the day and the minute. */
const localTime = (date: Date): string =>
  date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const unwritten = (view: BreakdownView): number =>
  view.parts.filter((part) => part.state !== 'written').length;

/** Whether some part is failed or missing, so that a run would have something to fill in. */
export const hasGaps = (view: BreakdownView): boolean => unwritten(view) > 0;

/** When a stored breakdown was written, and how many of its parts are not there. */
export function writtenLine(
  view: BreakdownView,
  format: (date: Date) => string = localTime,
): string {
  if (view.writtenAt === null) return 'No part of it is written yet.';
  const at = new Date(view.writtenAt);
  const when = Number.isNaN(at.getTime()) ? 'Written.' : `Written ${format(at)}.`;
  const gaps = unwritten(view);
  if (gaps === 0) return when;
  return `${when} ${gaps} ${gaps === 1 ? 'part is' : 'parts are'} not written.`;
}

/** One quiet line beside a part's title: who wrote it, or why it is not there. */
export function partNote(part: BreakdownPartView): string {
  if (part.state === 'missing') return 'Not written yet';
  if (part.state === 'failed') {
    return part.reason === null ? 'Not written' : `Not written: ${part.reason}`;
  }
  if (part.engine === JGTUBE) return 'Worked out by Jgtube';
  return `Written by ${engineName(part.engine ?? '')}`;
}

/** What a part gives the owner to copy and to download. */
export interface PartAttachment {
  /** What it is called in a sentence: "master prompt". */
  readonly label: string;
  /** The text to copy; null when there is none. */
  readonly text: string | null;
  /** True when the text to copy is the part itself, already on screen. */
  readonly inBody: boolean;
  readonly file: BreakdownFileView | null;
  /** Why there is nothing to copy, in plain words. */
  readonly problem: string | null;
}

const ATTACHED: Partial<
  Record<
    BreakdownPartId,
    { readonly label: string; readonly file: BreakdownFileId; readonly whole: boolean }
  >
> = {
  plan: { label: 'production plan', file: 'plan', whole: true },
  thumbnails: { label: 'thumbnail prompt', file: 'thumbnail', whole: false },
  master: { label: 'master prompt', file: 'master', whole: false },
};

const NO_PROMPT = 'No prompt could be found in this part.';

/**
 * The text a part gives to copy and download: the production plan whole, or
 * the prompt lifted out of the thumbnail part or the master prompt part.
 * Null for a part that has none, or that is not written.
 */
export function attachmentOf(view: BreakdownView, id: BreakdownPartId): PartAttachment | null {
  const attached = ATTACHED[id];
  const part = view.parts.find((entry) => entry.id === id);
  if (attached === undefined || part === undefined || part.state !== 'written') return null;
  const file = view.files.find((entry) => entry.id === attached.file) ?? null;
  const text = attached.whole ? part.body : part.prompt;
  return {
    label: attached.label,
    text,
    inBody: attached.whole,
    file,
    problem: text === null ? (file?.reason ?? NO_PROMPT) : null,
  };
}

/** Where one of a channel's four texts is downloaded from. */
export const textUrl = (channelId: string, name: string): string =>
  `/api/breakdowns/texts/${name}?channel=${encodeURIComponent(channelId)}`;

const FILE_WORDS: Readonly<Record<BreakdownFileId, string>> = {
  whole: 'the breakdown',
  plan: 'the production plan',
  thumbnail: 'the thumbnail prompt',
  master: 'the master prompt',
};

const listed = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Where the text files were saved on this computer, or why they were not. */
export function savedLine(view: BreakdownView, notSaved: string | null): string {
  if (view.folder === null) {
    return notSaved === null
      ? 'The text files are not saved on this computer yet. You can download each one below.'
      : `The text files were not saved on this computer: ${notSaved} You can still download each one below.`;
  }
  const names = view.files.filter((file) => file.available).map((file) => FILE_WORDS[file.id]);
  const saved = names.length === 1 ? 'is saved as a text file' : 'are saved as text files';
  return `${capitalised(listed(names))} ${saved} in ${view.folder}`;
}

/** A length of time as a person says it: "42 s", "2 min 15 s". */
export function durationText(seconds: number): string {
  if (seconds < 1) return 'under a second';
  const minutes = Math.floor(seconds / MINUTE_SECONDS);
  const rest = Math.round(seconds % MINUTE_SECONDS);
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

function runLine(run: PartRun): string {
  const title = PART_TITLES[run.part];
  if (run.outcome === 'kept') {
    return `${title}: kept from the last breakdown (written by ${engineName(run.engine)}), since nothing it rests on has changed.`;
  }
  if (run.outcome === 'failed') {
    const after = run.seconds > 0 ? ` after ${durationText(run.seconds)}` : '';
    return `${title}: not written${after}. ${run.reason}`;
  }
  const passed = run.skipped
    .map((entry) => ` ${capitalised(engineName(entry.engine))} was passed over: ${entry.message}`)
    .join('');
  return `${title}: written by ${engineName(run.engine)} in ${durationText(run.seconds)}.${passed}`;
}

const NOTHING_CHANGED =
  'Nothing had changed, so nothing was written again. Tick “Start again from nothing” to have everything studied and written again.';

/** How writing each part went in the run just finished, a line each, then the time it took in all. */
export function runLines(runs: readonly PartRun[]): readonly string[] {
  if (runs.length === 0) return [];
  const ran = runs.filter((run) => run.outcome !== 'kept');
  const total = ran.reduce((sum, run) => sum + run.seconds, 0);
  return [
    ...runs.map(runLine),
    ran.length === 0 ? NOTHING_CHANGED : `Writing took ${durationText(total)} in all.`,
  ];
}

/** What to say when the browser refuses to put a text on the clipboard. */
export const copyFailedText = (label: string): string =>
  `The browser would not copy the ${label}. Use “Download .txt” instead.`;

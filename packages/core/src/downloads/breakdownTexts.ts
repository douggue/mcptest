import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import {
  BREAKDOWN_BASIS_PART,
  BREAKDOWN_PART_TITLES,
  BREAKDOWN_WRITTEN_PARTS,
  PROMPT_MARKERS,
  splitMarked,
  type BreakdownPartId,
} from '../breakdown/parts';
import type { StoredBreakdownPart } from '../repos/types';
import { channelFolder, pathInside } from './folder';

/**
 * A finished breakdown as plain text files the owner can open, copy from and
 * hand to another program: the whole breakdown, the production plan, and the
 * two ready prompts lifted out as they stand. The texts are put together
 * here, in code, from the stored parts; the files are written under the
 * downloads folder, in a folder named after the channel.
 */

/** The folder under the downloads folder that holds one folder per channel. */
export const BREAKDOWNS_FOLDER = 'breakdowns';
export const BREAKDOWN_INDEX_FILE = 'index.json';
/** The four files, the same names for every channel. */
export const BREAKDOWN_FILES = {
  whole: 'breakdown.txt',
  plan: 'production-plan.txt',
  thumbnail: 'thumbnail-prompt.txt',
  master: 'master-prompt.txt',
} as const;
export type BreakdownFileId = keyof typeof BREAKDOWN_FILES;
export const BREAKDOWN_FILE_IDS = Object.keys(BREAKDOWN_FILES) as readonly BreakdownFileId[];

const JSON_INDENT = 2;
const RULE = '='.repeat(60);
const FACTS_NOTE =
  'Check every fact before you publish: an AI wrote these parts from titles, captions and pictures, and it can be wrong.';
const NOTHING_WRITTEN = 'No part of the breakdown has been written.';

/** One of the four texts: what it holds, or why there is nothing to hold. */
export type BreakdownTextFile = {
  readonly id: BreakdownFileId;
  /** The file's name inside the channel's folder. */
  readonly name: string;
} & (
  | { readonly text: string; readonly reason: null }
  | { readonly text: null; readonly reason: string }
);

interface Channel {
  readonly id: string;
  readonly title: string;
}

type Found = { readonly text: string } | { readonly reason: string };

const day = (date: Date): string => date.toISOString().slice(0, 10);
const withEnd = (text: string): string => `${text.trim()}\n`;

/** What a part is called in a sentence that says it is missing. */
const named = (part: BreakdownPartId): string =>
  part === 'plan' ? 'The production plan' : `The ${BREAKDOWN_PART_TITLES[part].toLowerCase()} part`;

/** A part's text, or why it has none. */
function textOf(parts: readonly StoredBreakdownPart[], id: BreakdownPartId): Found {
  const part = parts.find((stored) => stored.part === id);
  if (part === undefined) return { reason: `${named(id)} has not been written.` };
  return part.written
    ? { text: part.text }
    : { reason: `${named(id)} was not written: ${part.reason}` };
}

/** The prompt a part holds between its marker lines, or why there is none; never a guess. */
function promptOf(parts: readonly StoredBreakdownPart[], id: keyof typeof PROMPT_MARKERS): Found {
  const part = textOf(parts, id);
  if ('reason' in part) return part;
  const { marked } = splitMarked(part.text, PROMPT_MARKERS[id]);
  return marked === null
    ? {
        reason: `${named(id)} does not hold a prompt between the two marker lines it was asked for, so nothing was saved.`,
      }
    : { text: marked };
}

const headed = (heading: string, body: string): string =>
  [RULE, heading.toUpperCase(), RULE, '', body.trim(), ''].join('\n');

/** Every part in order under a heading of its own, a part that was not written saying why. */
function wholeText(channel: Channel, parts: readonly StoredBreakdownPart[]): Found {
  const written = parts.filter((part) => part.written);
  if (written.length === 0) return { reason: NOTHING_WRITTEN };
  const latest = new Date(Math.max(...written.map((part) => part.writtenAt.getTime())));
  const body = (id: BreakdownPartId): string => {
    const part = textOf(parts, id);
    return 'text' in part ? part.text : `NOT WRITTEN: ${part.reason.replace(/^.*?: /, '')}`;
  };
  const count = BREAKDOWN_WRITTEN_PARTS.length;
  return {
    text: [
      `CHANNEL BREAKDOWN: ${channel.title}`,
      `https://www.youtube.com/channel/${channel.id}`,
      `Written ${day(latest)} by Jgtube from what it has stored about this channel.`,
      FACTS_NOTE,
      '',
      headed(BREAKDOWN_PART_TITLES[BREAKDOWN_BASIS_PART], body(BREAKDOWN_BASIS_PART)),
      ...BREAKDOWN_WRITTEN_PARTS.map((id, index) =>
        headed(`Part ${index + 1} of ${count}: ${BREAKDOWN_PART_TITLES[id]}`, body(id)),
      ),
    ].join('\n'),
  };
}

/**
 * The four texts of one channel's breakdown, put together from its stored
 * parts. A text that cannot be made (a part not written, a prompt whose
 * marker lines are missing) comes with the reason instead.
 */
export function breakdownTexts(
  channel: Channel,
  parts: readonly StoredBreakdownPart[],
): readonly BreakdownTextFile[] {
  const found: Readonly<Record<BreakdownFileId, Found>> = {
    whole: wholeText(channel, parts),
    plan: textOf(parts, 'plan'),
    thumbnail: promptOf(parts, 'thumbnails'),
    master: promptOf(parts, 'master'),
  };
  const nothing = !parts.some((part) => part.written);
  return BREAKDOWN_FILE_IDS.map((id): BreakdownTextFile => {
    const file = found[id];
    const head = { id, name: BREAKDOWN_FILES[id] };
    if ('text' in file) return { ...head, text: withEnd(file.text), reason: null };
    return { ...head, text: null, reason: nothing ? NOTHING_WRITTEN : file.reason };
  });
}

/** Where a breakdown's texts were saved, and which could not be. */
export interface BreakdownSaved {
  /** The channel's folder, as an absolute path. */
  readonly folder: string;
  readonly indexFile: string;
  /** The names of the files now in the folder. */
  readonly saved: readonly string[];
  readonly notSaved: readonly { readonly file: string; readonly reason: string }[];
}

/**
 * Writes the texts under `<root>/breakdowns/<channel name>/` and an
 * `index.json` beside them that says which channel the folder belongs to. A
 * text that could not be made is not written, and an older copy of it is
 * removed, so the folder never holds a file from another run that the index
 * does not vouch for.
 */
export async function saveBreakdownTexts(
  root: string,
  channel: Channel,
  files: readonly BreakdownTextFile[],
  savedAt: Date,
): Promise<BreakdownSaved> {
  const folder = await channelFolder(
    pathInside(root, BREAKDOWNS_FOLDER),
    channel,
    BREAKDOWN_INDEX_FILE,
  );
  await mkdir(folder, { recursive: true });
  for (const file of files) {
    const path = pathInside(folder, file.name);
    if (file.text === null) await rm(path, { force: true });
    else await writeFile(path, file.text, 'utf8');
  }
  const saved = files.flatMap((file) => (file.text === null ? [] : [file.name]));
  const notSaved = files.flatMap((file) =>
    file.text === null ? [{ file: file.name, reason: file.reason }] : [],
  );
  const indexFile = pathInside(folder, BREAKDOWN_INDEX_FILE);
  const index = {
    channelId: channel.id,
    channelTitle: channel.title,
    savedAt: savedAt.toISOString(),
    files: saved,
    notSaved,
  };
  await writeFile(indexFile, `${JSON.stringify(index, null, JSON_INDENT)}\n`, 'utf8');
  return { folder, indexFile, saved, notSaved };
}

/**
 * The folder a channel's breakdown was saved in, or null when none was: the
 * folder counts only when its index says it belongs to this channel.
 */
export async function breakdownFolder(root: string, channel: Channel): Promise<string | null> {
  const folder = await channelFolder(
    pathInside(root, BREAKDOWNS_FOLDER),
    channel,
    BREAKDOWN_INDEX_FILE,
  );
  const owner = await readFile(pathInside(folder, BREAKDOWN_INDEX_FILE), 'utf8')
    .then((text) => (JSON.parse(text) as { channelId?: unknown }).channelId)
    .catch(() => undefined);
  return owner === channel.id ? folder : null;
}

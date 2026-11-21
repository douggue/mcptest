import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Config } from '../config';
import { isFileStore } from '../db/backup';

/**
 * Where downloaded files go. Everything Jgtube saves to disk besides the
 * store lives under one folder, so the owner knows where to look and nothing
 * is ever written anywhere else.
 */

/** The folder's name when the owner has not chosen one: beside the store. */
export const DOWNLOADS_FOLDER = 'downloads';

/**
 * The downloads folder as an absolute path: the one set in
 * `JGTUBE_DOWNLOADS_PATH`, else "downloads" beside the store file. A store
 * that is only in memory has no folder beside it, so one must then be named.
 */
export function downloadsRoot(config: Pick<Config, 'dbPath' | 'downloadsPath'>): string {
  if (config.downloadsPath !== undefined) return resolve(config.downloadsPath);
  if (!isFileStore(config.dbPath)) {
    throw new Error(
      'This store is only in memory, so there is no folder beside it to save into. Set JGTUBE_DOWNLOADS_PATH.',
    );
  }
  return join(dirname(resolve(config.dbPath)), DOWNLOADS_FOLDER);
}

/** Characters a folder name may not hold on Windows, and control characters. */
const UNSAFE_IN_NAME = /[<>:"/\\|?*\u0000-\u001f]/g;
/** Names Windows keeps for itself, whatever follows a dot. */
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_FOLDER_NAME = 80;

/**
 * A folder name made from a channel's title, safe on Windows and Mac: the
 * title with the characters a file system refuses taken out. A title that
 * leaves nothing usable gives the channel id instead.
 */
export function channelFolderName(title: string, channelId: string): string {
  const cleaned = title
    .replace(UNSAFE_IN_NAME, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FOLDER_NAME)
    .replace(/[. ]+$/, '');
  return cleaned === '' || RESERVED_NAME.test(cleaned) ? channelId : cleaned;
}

/**
 * The folder a channel's saved files go into, inside `parent`: named after
 * the channel. Two channels can share a title, so when a folder of that name
 * already belongs to another channel (its index file says which), the
 * channel id is added to the name.
 */
export async function channelFolder(
  parent: string,
  channel: { readonly id: string; readonly title: string },
  indexFile: string,
): Promise<string> {
  const name = channelFolderName(channel.title, channel.id);
  const folder = pathInside(parent, name);
  const owner = await readFile(pathInside(folder, indexFile), 'utf8')
    .then((text) => (JSON.parse(text) as { channelId?: unknown }).channelId)
    .catch(() => undefined);
  const taken = typeof owner === 'string' && owner !== channel.id;
  return taken ? pathInside(parent, `${name} [${channel.id}]`) : folder;
}

/**
 * A path inside a folder, built from parts that must stay inside it. Throws
 * when the result would land anywhere else, whatever the parts hold.
 */
export function pathInside(folder: string, ...parts: readonly string[]): string {
  const root = resolve(folder);
  const target = resolve(root, ...parts);
  const offset = relative(root, target);
  if (offset === '' || offset.startsWith('..') || isAbsolute(offset)) {
    throw new Error('That would be saved outside the downloads folder');
  }
  return target;
}

/**
 * A path that must lie inside one of several folders, as an absolute path.
 * Throws when it lies in none of them.
 */
export function pathInsideAny(folders: readonly string[], path: string): string {
  for (const folder of folders) {
    try {
      return pathInside(folder, path);
    } catch {
      // Not in this folder; the next one is tried.
    }
  }
  throw new Error('That file is outside the folders it may be read from');
}

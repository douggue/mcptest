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

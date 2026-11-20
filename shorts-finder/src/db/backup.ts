import { basename, dirname, extname, join } from 'node:path';
import type { Db } from './sqlite';

/**
 * Copies of the store. The store is the owner's accumulated readings, most of
 * which cannot be read from YouTube again (a view count an hour ago is gone),
 * so a copy is written before anything changes its shape, and whenever the
 * owner asks for one.
 */

const IN_MEMORY = ':memory:';

const twoDigits = (value: number): string => String(value).padStart(2, '0');

/** `20261120-090507`. In UTC, so the name does not depend on the computer's time zone. */
function stamp(at: Date): string {
  const day = `${at.getUTCFullYear()}${twoDigits(at.getUTCMonth() + 1)}${twoDigits(at.getUTCDate())}`;
  const time = `${twoDigits(at.getUTCHours())}${twoDigits(at.getUTCMinutes())}${twoDigits(at.getUTCSeconds())}`;
  return `${day}-${time}`;
}

/** Whether the store is a file on disk; one in memory has nothing to copy. */
export const isFileStore = (storePath: string): boolean =>
  storePath !== IN_MEMORY && storePath !== '';

/** Where a copy of the store goes: beside it, named after its version and the time. */
export function backupPathFor(storePath: string, version: number, at: Date): string {
  const name = basename(storePath, extname(storePath));
  return join(dirname(storePath), `${name}.backup-v${version}-${stamp(at)}.db`);
}

/**
 * Writes a whole, consistent copy of the store beside it and returns the
 * copy's path. Throws when the copy cannot be written, or when a file of that
 * name is already there: an earlier copy is never written over.
 */
export function backupStore(db: Db, storePath: string, at: Date): string {
  if (!isFileStore(storePath)) {
    throw new Error('This store is only in memory, so there is nothing to copy');
  }
  const version = Number(db.pragma('user_version', { simple: true }));
  const target = backupPathFor(storePath, version, at);
  db.prepare('VACUUM INTO ?').run(target);
  return target;
}

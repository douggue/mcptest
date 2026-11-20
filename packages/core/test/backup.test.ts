import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { backupPathFor, backupStore } from '../src/db/backup';
import { openDatabase } from '../src/db/sqlite';

const NOW = new Date('2026-11-20T09:05:07Z');
const CHANNEL_ID = `UC${'B'.repeat(22)}`;
/** The channels table as the first version of Jgtube made it. */
const FIRST_CHANNELS_TABLE = `
CREATE TABLE channels (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, handle TEXT, handle_lower TEXT,
  subscribers INTEGER, subs_hidden INTEGER NOT NULL, video_count INTEGER,
  fetched_at TEXT NOT NULL
);`;

let folder: string;
let storePath: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-backup-'));
  storePath = join(folder, 'jgtube.db');
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** A store as an early version left it: unversioned, optionally holding one channel. */
function makeOldStore(withData: boolean): void {
  const old = new Database(storePath);
  old.exec(FIRST_CHANNELS_TABLE);
  if (withData) {
    old
      .prepare(
        `INSERT INTO channels (id, title, subs_hidden, fetched_at) VALUES (?, 'Research', 0, ?)`,
      )
      .run(CHANNEL_ID, NOW.toISOString());
  }
  old.close();
}

const backups = (): string[] => readdirSync(folder).filter((name) => name.includes('.backup-'));

function titlesIn(path: string): unknown[] {
  const copy = new Database(path, { readonly: true });
  try {
    return copy.prepare('SELECT title FROM channels').pluck().all();
  } finally {
    copy.close();
  }
}

const versionOf = (path: string): unknown => {
  const db = new Database(path, { readonly: true });
  try {
    return db.pragma('user_version', { simple: true });
  } finally {
    db.close();
  }
};

describe('backupPathFor', () => {
  test('names the copy after the store, its version and the time, beside the store', () => {
    expect(backupPathFor(storePath, 7, NOW)).toBe(
      join(folder, 'jgtube.backup-v7-20261120-090507.db'),
    );
    expect(backupPathFor(join(folder, 'research'), 0, NOW)).toBe(
      join(folder, 'research.backup-v0-20261120-090507.db'),
    );
  });
});

describe('backupStore', () => {
  test('writes a whole copy of the store and says where it is', () => {
    makeOldStore(true);
    const db = openDatabase(storePath, NOW);
    const later = new Date('2026-11-21T10:00:00Z');

    const written = backupStore(db, storePath, later);
    db.close();

    expect(written).toBe(backupPathFor(storePath, Number(versionOf(storePath)), later));
    expect(titlesIn(written)).toEqual(['Research']);
    expect(versionOf(written)).toBe(versionOf(storePath));
  });

  test('refuses a store that lives only in memory', () => {
    const db = openDatabase(':memory:');

    expect(() => backupStore(db, ':memory:', NOW)).toThrow(/only in memory/);
    db.close();
  });
});

describe('opening a store that needs updating', () => {
  test('first writes a dated copy of it as it was', () => {
    makeOldStore(true);

    const db = openDatabase(storePath, NOW);
    const updated = Number(db.pragma('user_version', { simple: true }));
    db.close();

    expect(backups()).toEqual(['jgtube.backup-v0-20261120-090507.db']);
    const copy = join(folder, backups()[0]!);
    expect(versionOf(copy)).toBe(0);
    expect(titlesIn(copy)).toEqual(['Research']);
    expect(updated).toBeGreaterThan(0);
    expect(titlesIn(storePath)).toEqual(['Research']);
  });

  test('does not update it when the copy cannot be written', () => {
    makeOldStore(true);
    writeFileSync(backupPathFor(storePath, 0, NOW), 'in the way');

    expect(() => openDatabase(storePath, NOW)).toThrow(/could not be backed up/);

    expect(versionOf(storePath)).toBe(0);
  });

  test('makes no copy of a brand-new store', () => {
    openDatabase(storePath, NOW).close();

    expect(backups()).toEqual([]);
  });

  test('makes no copy of an old store that holds nothing', () => {
    makeOldStore(false);

    openDatabase(storePath, NOW).close();

    expect(backups()).toEqual([]);
  });

  test('makes no copy of a store that is already up to date', () => {
    makeOldStore(true);
    openDatabase(storePath, NOW).close();
    const before = backups();

    openDatabase(storePath, new Date('2026-11-22T00:00:00Z')).close();

    expect(backups()).toEqual(before);
  });

  test('makes no copy of a store in memory', () => {
    const db = openDatabase(':memory:', NOW);

    expect(Number(db.pragma('user_version', { simple: true }))).toBeGreaterThan(0);
    db.close();
  });
});

describe('npm run backup', () => {
  const run = promisify(execFile);
  const root = resolve(import.meta.dirname, '../../..');

  test('writes a dated copy of the store and prints where it is', async () => {
    makeOldStore(true);
    openDatabase(storePath, NOW).close();
    rmSync(join(folder, backups()[0]!));

    // Started in the temporary folder, so no .env file of the owner's is read.
    const { stdout } = await run(
      process.execPath,
      [
        join(root, 'node_modules/tsx/dist/cli.mjs'),
        join(root, 'packages/core/src/cli.ts'),
        'backup',
      ],
      { cwd: folder, env: { PATH: process.env['PATH'], JGTUBE_DB_PATH: storePath } },
    );

    const [name] = backups();
    expect(name).toMatch(/^jgtube\.backup-v\d+-\d{8}-\d{6}\.db$/);
    expect(stdout).toContain(join(folder, name!));
    expect(titlesIn(join(folder, name!))).toEqual(['Research']);
  }, 30_000);
});

import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { backupPathFor, backupStore } from '../src/db/backup';
import { MIGRATIONS, migrate, openDatabase, transactionRunner, type Db } from '../src/db/sqlite';

const NOW = new Date('2026-11-20T09:05:07Z');
const STAMP = NOW.toISOString();
const CHANNEL_ID = `UC${'B'.repeat(22)}`;
const VIDEO_ID = 'vid00000001';
const TABLES = [
  'channels',
  'findings',
  'quota_ledger',
  'subject_hits',
  'subjects',
  'video_snapshots',
  'video_tracking',
  'videos',
  'work_leases',
];
/** A later step, as a second version of the store would add one. */
const NEXT_STEP = 'ALTER TABLE channels ADD COLUMN note TEXT;';

let folder: string;
let storePath: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'shorts-store-'));
  storePath = join(folder, 'shorts.db');
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const versionOf = (db: Db): number => Number(db.pragma('user_version', { simple: true }));
const backups = (): string[] => readdirSync(folder).filter((name) => name.includes('.backup-'));

function addChannel(db: Db): void {
  db.prepare(
    `INSERT INTO channels (id, title, subs_hidden, fetched_at) VALUES (?, 'Paper Folds Daily', 0, ?)`,
  ).run(CHANNEL_ID, STAMP);
}

function addVideo(db: Db): void {
  db.prepare(
    `INSERT INTO videos (id, channel_id, title, views, duration_s, published_at, fetched_at)
     VALUES (?, ?, 'Folding a crane in forty seconds', 1200, 40, ?, ?)`,
  ).run(VIDEO_ID, CHANNEL_ID, STAMP, STAMP);
}

function titlesIn(path: string): unknown[] {
  const copy = new Database(path, { readonly: true });
  try {
    return copy.prepare('SELECT title FROM channels').pluck().all();
  } finally {
    copy.close();
  }
}

describe('openDatabase', () => {
  test('makes every table of the first version in a new store', () => {
    const db = openDatabase(':memory:');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .pluck()
      .all();
    db.close();

    expect(tables.filter((name) => name !== 'sqlite_sequence')).toEqual(TABLES);
  });

  test('records how many steps have run in the store itself', () => {
    const db = openDatabase(':memory:');

    expect(versionOf(db)).toBe(MIGRATIONS.length);
    db.close();
  });

  test('keeps what the official API says about a channel and a video', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      `INSERT INTO channels (id, title, country, created_at, subscribers, subs_hidden,
         video_count, total_views, uploads_playlist_id, fetched_at)
       VALUES (?, 'Night Sky Minute', 'CA', ?, 640, 0, 31, 880000, ?, ?)`,
    ).run(CHANNEL_ID, STAMP, `UU${'B'.repeat(22)}`, STAMP);
    db.prepare(
      `INSERT INTO videos (id, channel_id, title, views, duration_s, published_at, category_id,
         default_language, default_audio_language, fetched_at)
       VALUES (?, ?, 'Why the moon looks bigger at the horizon', NULL, 58, ?, '28', 'en', 'en-CA', ?)`,
    ).run(VIDEO_ID, CHANNEL_ID, STAMP, STAMP);

    const video = db.prepare('SELECT views, duration_s, category_id FROM videos').get();
    db.close();

    expect(video).toEqual({ views: null, duration_s: 58, category_id: '28' });
  });

  test('refuses a video whose channel is not stored', () => {
    const db = openDatabase(':memory:');

    expect(() => addVideo(db)).toThrow(/FOREIGN KEY/);
    db.close();
  });

  test('refuses a tracking tier, a Shorts answer or a finding kind the plan does not name', () => {
    const db = openDatabase(':memory:');
    addChannel(db);
    addVideo(db);
    const track = db.prepare(
      'INSERT INTO video_tracking (video_id, tier, next_read_at, is_short) VALUES (?, ?, ?, ?)',
    );
    const find = db.prepare(
      `INSERT INTO findings (video_id, channel_id, kind, reason, found_at) VALUES (?, ?, ?, '{}', ?)`,
    );

    expect(() => track.run(VIDEO_ID, 'weekly', STAMP, 'unknown')).toThrow(/CHECK/);
    expect(() => track.run(VIDEO_ID, 'hourly', STAMP, 'maybe')).toThrow(/CHECK/);
    expect(() => find.run(VIDEO_ID, CHANNEL_ID, 'hunch', STAMP)).toThrow(/CHECK/);
    expect(track.run(VIDEO_ID, 'hourly', STAMP, 'unknown').changes).toBe(1);
    expect(find.run(VIDEO_ID, CHANNEL_ID, 'niche', STAMP).changes).toBe(1);
    db.close();
  });

  test('remembers which search found a video only once', () => {
    const db = openDatabase(':memory:');
    addChannel(db);
    addVideo(db);
    db.prepare(
      `INSERT INTO subjects (keyword, region, language, every_hours, enabled)
       VALUES ('paper folding', 'US', 'en', 24, 1)`,
    ).run();
    const hit = db.prepare(
      'INSERT INTO subject_hits (subject_id, video_id, first_seen_at) VALUES (1, ?, ?)',
    );

    hit.run(VIDEO_ID, STAMP);

    expect(() => hit.run(VIDEO_ID, STAMP)).toThrow(/UNIQUE/);
    db.close();
  });

  test('closes the store and says why when it cannot be opened', () => {
    writeFileSync(storePath, 'this is not a database, only some text in the way');

    expect(() => openDatabase(storePath, NOW)).toThrow();
  });
});

describe('migrate', () => {
  test('runs only the steps a store has not had', () => {
    const db = new Database(':memory:');
    migrate(db, ['CREATE TABLE first (id INTEGER);']);

    migrate(db, ['CREATE TABLE first (id INTEGER);', 'CREATE TABLE second (id INTEGER);']);

    expect(versionOf(db)).toBe(2);
    expect(db.prepare('SELECT count(*) FROM second').pluck().get()).toBe(0);
    db.close();
  });

  test('leaves the version alone when a step fails', () => {
    const db = new Database(':memory:');

    expect(() => migrate(db, ['CREATE TABLE first (id INTEGER);', 'NOT SQL AT ALL;'])).toThrow();

    expect(versionOf(db)).toBe(1);
    db.close();
  });

  test('refuses a store made by a newer version', () => {
    const db = new Database(':memory:');
    db.pragma('user_version = 99');

    expect(() => migrate(db)).toThrow(/newer version of Shorts finder/);
    db.close();
  });
});

describe('opening a store that needs updating', () => {
  test('first writes a dated copy of it as it was', () => {
    const first = openDatabase(storePath, NOW);
    addChannel(first);
    first.close();

    const db = openDatabase(storePath, NOW, [...MIGRATIONS, NEXT_STEP]);
    const updated = versionOf(db);
    db.close();

    expect(backups()).toEqual([`shorts.backup-v${MIGRATIONS.length}-20261120-090507.db`]);
    expect(titlesIn(join(folder, backups()[0]!))).toEqual(['Paper Folds Daily']);
    expect(updated).toBe(MIGRATIONS.length + 1);
  });

  test('does not update it when the copy cannot be written', () => {
    const first = openDatabase(storePath, NOW);
    addChannel(first);
    first.close();
    writeFileSync(backupPathFor(storePath, MIGRATIONS.length, NOW), 'in the way');

    expect(() => openDatabase(storePath, NOW, [...MIGRATIONS, NEXT_STEP])).toThrow(
      /could not be backed up/,
    );

    const db = openDatabase(storePath, NOW);
    expect(versionOf(db)).toBe(MIGRATIONS.length);
    db.close();
  });

  test('copies nothing for an empty store, a new one or one already up to date', () => {
    openDatabase(storePath, NOW).close();
    openDatabase(storePath, NOW, [...MIGRATIONS, NEXT_STEP]).close();
    const db = openDatabase(storePath, NOW, [...MIGRATIONS, NEXT_STEP]);
    addChannel(db);
    db.close();
    openDatabase(storePath, NOW, [...MIGRATIONS, NEXT_STEP]).close();

    expect(backups()).toEqual([]);
  });
});

describe('backupStore', () => {
  test('names the copy after the store, its version and the time, beside the store', () => {
    expect(backupPathFor(storePath, 7, NOW)).toBe(
      join(folder, 'shorts.backup-v7-20261120-090507.db'),
    );
  });

  test('writes a whole copy of the store and says where it is', () => {
    const db = openDatabase(storePath, NOW);
    addChannel(db);

    const written = backupStore(db, storePath, NOW);
    db.close();

    expect(written).toBe(backupPathFor(storePath, MIGRATIONS.length, NOW));
    expect(titlesIn(written)).toEqual(['Paper Folds Daily']);
  });

  test('never writes over an earlier copy', () => {
    const db = openDatabase(storePath, NOW);
    backupStore(db, storePath, NOW);

    expect(() => backupStore(db, storePath, NOW)).toThrow();
    db.close();
  });

  test('refuses a store that lives only in memory', () => {
    const db = openDatabase(':memory:');

    expect(() => backupStore(db, ':memory:', NOW)).toThrow(/only in memory/);
    db.close();
  });
});

describe('transactionRunner', () => {
  test('writes everything or nothing', () => {
    const db = openDatabase(':memory:');
    const transact = transactionRunner(db);

    expect(() =>
      transact(() => {
        addChannel(db);
        throw new Error('stopped half way');
      }),
    ).toThrow(/half way/);
    transact(() => addChannel(db));

    expect(db.prepare('SELECT count(*) FROM channels').pluck().get()).toBe(1);
    db.close();
  });
});

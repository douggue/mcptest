import Database from 'better-sqlite3';
import type { Transact } from '../repos/types';
import { backupStore, isFileStore } from './backup';

export type Db = Database.Database;

/**
 * Applied in order; SQLite's `user_version` records how many have run.
 * Never edit a migration that has shipped: add another after it.
 *
 * Times are ISO-8601 text in UTC, which sorts in time order. The one exception
 * is `quota_ledger.day`, a calendar day in Pacific time, where the API's
 * allowance resets.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: channels and videos as the official API describes them, readings of
  // their views, the subjects searched for, the allowance spent and what was found.
  `
CREATE TABLE channels (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  country              TEXT,
  created_at           TEXT,
  subscribers          INTEGER,
  subs_hidden          INTEGER NOT NULL,
  video_count          INTEGER,
  total_views          INTEGER,
  uploads_playlist_id  TEXT,
  fetched_at           TEXT NOT NULL
);

CREATE TABLE videos (
  id                      TEXT PRIMARY KEY,
  channel_id              TEXT NOT NULL REFERENCES channels (id),
  title                   TEXT NOT NULL,
  views                   INTEGER,
  duration_s              INTEGER,
  published_at            TEXT NOT NULL,
  category_id             TEXT,
  default_language        TEXT,
  default_audio_language  TEXT,
  fetched_at              TEXT NOT NULL
);
CREATE INDEX videos_channel_published ON videos (channel_id, published_at);

CREATE TABLE video_snapshots (
  video_id     TEXT NOT NULL REFERENCES videos (id),
  captured_at  TEXT NOT NULL,
  views        INTEGER NOT NULL,
  PRIMARY KEY (video_id, captured_at)
);

CREATE TABLE work_leases (
  name        TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE subjects (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword           TEXT NOT NULL,
  region            TEXT NOT NULL,
  language          TEXT NOT NULL,
  every_hours       INTEGER NOT NULL,
  enabled           INTEGER NOT NULL,
  last_searched_at  TEXT,
  UNIQUE (keyword, region, language)
);

CREATE TABLE subject_hits (
  subject_id     INTEGER NOT NULL REFERENCES subjects (id),
  video_id       TEXT NOT NULL REFERENCES videos (id),
  first_seen_at  TEXT NOT NULL,
  PRIMARY KEY (subject_id, video_id)
);

CREATE TABLE quota_ledger (
  day          TEXT PRIMARY KEY,
  units_spent  INTEGER NOT NULL,
  by_kind      TEXT NOT NULL
);

CREATE TABLE video_tracking (
  video_id      TEXT PRIMARY KEY REFERENCES videos (id),
  tier          TEXT NOT NULL CHECK (tier IN ('hourly', 'six_hourly', 'done')),
  next_read_at  TEXT,
  is_short      TEXT NOT NULL CHECK (is_short IN ('yes', 'no', 'unknown'))
);
CREATE INDEX video_tracking_next_read ON video_tracking (next_read_at);

CREATE TABLE findings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id        TEXT NOT NULL REFERENCES videos (id),
  channel_id      TEXT NOT NULL REFERENCES channels (id),
  kind            TEXT NOT NULL CHECK (kind IN ('niche', 'transfer')),
  reason          TEXT NOT NULL,
  views_per_hour  REAL,
  earnings_low    REAL,
  earnings_high   REAL,
  found_at        TEXT NOT NULL,
  alerted_at      TEXT
);
CREATE INDEX findings_video ON findings (video_id);
`,
];

/**
 * Brings a store up to date, one numbered step at a time. Each step and its
 * version number are written together or not at all, and the version is read
 * again under the write lock so two processes cannot run the same step.
 */
export function migrate(db: Db, steps: readonly string[] = MIGRATIONS): void {
  const version = (): number => Number(db.pragma('user_version', { simple: true }));
  if (version() > steps.length) {
    throw new Error(
      'This store was made by a newer version of Shorts finder. Update Shorts finder to open it.',
    );
  }
  steps.forEach((sql, index) => {
    db.transaction(() => {
      if (version() > index) return;
      db.exec(sql);
      db.pragma(`user_version = ${index + 1}`);
    }).immediate();
  });
}

/** Whether the store holds anything worth keeping: at least one channel. */
function hasData(db: Db): boolean {
  const table = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'channels'")
    .get();
  return table !== undefined && db.prepare('SELECT 1 FROM channels LIMIT 1').get() !== undefined;
}

/**
 * Writes a dated copy of a store that is about to be updated. A store in
 * memory, a new empty one and one already up to date are left alone. If the
 * copy cannot be written this throws, so the store is never updated without one.
 */
function backupBeforeUpdating(db: Db, path: string, now: Date, stepCount: number): void {
  const version = Number(db.pragma('user_version', { simple: true }));
  if (!isFileStore(path) || version >= stepCount || !hasData(db)) return;
  try {
    backupStore(db, path, now);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The store could not be backed up before updating it, so it was left as it is: ${reason}`,
      { cause: error },
    );
  }
}

/**
 * Opens the store and brings its tables up to date, after copying a store
 * that holds data and needs updating. Pass ":memory:" for tests. `steps`
 * replaces the migrations; used by tests to stand in for a later version.
 */
export function openDatabase(
  path: string,
  now: Date = new Date(),
  steps: readonly string[] = MIGRATIONS,
): Db {
  const db = new Database(path);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    backupBeforeUpdating(db, path, now, steps.length);
    migrate(db, steps);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function transactionRunner(db: Db): Transact {
  return (work) => {
    db.transaction(work)();
  };
}

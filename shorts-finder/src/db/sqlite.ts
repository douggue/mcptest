import Database from 'better-sqlite3';
import type { Transact } from '../repos/types';
import { backupStore, isFileStore } from './backup';

export type Db = Database.Database;

/**
 * Applied in order; SQLite's `user_version` records how many have run.
 * Never edit a migration that has shipped: add another after it. (The first
 * was revised once, before any store had been made with it.)
 *
 * Times are ISO-8601 text in UTC, which sorts in time order. Two exceptions:
 * `quota_ledger.day` is a calendar day in Pacific time, where the API's
 * allowance resets, and `video_snapshots.captured_at` is whole seconds since
 * 1970 (UTC), because readings are by far the most rows and a number is
 * smaller and quicker to compare than text.
 *
 * What goes when a video is deleted: its readings, its tracking and the record
 * of which searches found it. A finding does not: it carries its own copy of
 * what it needs (ids, titles, the figures) and refers to no other row.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: channels and videos as the official API describes them, readings of
  // their views, the subjects searched for, the allowance spent and what was found.
  `
CREATE TABLE channels (
  id                   TEXT PRIMARY KEY,
  title                TEXT,
  country              TEXT,
  created_at           TEXT,
  subscribers          INTEGER,
  subs_hidden          INTEGER NOT NULL,
  video_count          INTEGER,
  total_views          INTEGER,
  uploads_playlist_id  TEXT,
  fetched_at           TEXT NOT NULL,
  read_queued_at       TEXT
);
CREATE INDEX channels_read_queued ON channels (read_queued_at) WHERE read_queued_at IS NOT NULL;

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
  video_id     TEXT NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  captured_at  INTEGER NOT NULL,
  views        INTEGER NOT NULL,
  PRIMARY KEY (video_id, captured_at)
) WITHOUT ROWID;
CREATE INDEX video_snapshots_captured ON video_snapshots (captured_at);

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
  subject_id     INTEGER NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  video_id       TEXT NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  first_seen_at  TEXT NOT NULL,
  PRIMARY KEY (subject_id, video_id)
) WITHOUT ROWID;
CREATE INDEX subject_hits_video ON subject_hits (video_id);

CREATE TABLE quota_ledger (
  day          TEXT PRIMARY KEY,
  units_spent  INTEGER NOT NULL,
  by_kind      TEXT NOT NULL
);

CREATE TABLE video_tracking (
  video_id      TEXT PRIMARY KEY REFERENCES videos (id) ON DELETE CASCADE,
  tier          TEXT NOT NULL CHECK (tier IN ('hourly', 'six_hourly', 'done')),
  next_read_at  TEXT,
  is_short      TEXT NOT NULL CHECK (is_short IN ('yes', 'no', 'unknown')),
  missed_reads  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX video_tracking_next_read ON video_tracking (next_read_at);

CREATE TABLE findings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id        TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  video_title     TEXT NOT NULL,
  channel_title   TEXT,
  published_at    TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('niche', 'transfer')),
  reason          TEXT NOT NULL,
  views_per_hour  REAL,
  earnings_low    REAL,
  earnings_high   REAL,
  found_at        TEXT NOT NULL,
  alerted_at      TEXT,
  UNIQUE (video_id, kind)
);
CREATE INDEX findings_unalerted ON findings (found_at) WHERE alerted_at IS NULL;
`,
  // 2: what the alerts and the service need to remember. A finding left out of
  // the one-by-one alerts by the daily cap is told of in the day's summary
  // instead, and `digested_at` says so, so it is not sent again later. The
  // service's own memory (when each round last ran, which day's summary went
  // out) is a few named values, so a restart carries on where it stopped.
  `
ALTER TABLE findings ADD COLUMN digested_at TEXT;

CREATE TABLE service_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
) WITHOUT ROWID;
`,
  // 3: what the review of the cycles asked for. Tracking remembers when a
  // video was last missed and when and why its tracking ended, so a video is
  // never deleted on a miss. A channel counts the reads that could not be
  // read, and a finding the messages Telegram would not take, so neither is
  // tried for ever. A search's results are kept the moment the search answers
  // (`pending_hits`), before their details are read, so a paid search is never
  // lost; and videos a search returns that will never be tracked are
  // remembered (`passed_over_videos`), so they are not paid for again.
  `
ALTER TABLE video_tracking ADD COLUMN last_missed_at TEXT;
ALTER TABLE video_tracking ADD COLUMN finished_at TEXT;
ALTER TABLE video_tracking ADD COLUMN finish_reason TEXT;

ALTER TABLE channels ADD COLUMN read_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE findings ADD COLUMN send_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE findings ADD COLUMN skipped_at TEXT;
ALTER TABLE findings ADD COLUMN skip_reason TEXT;

CREATE TABLE pending_hits (
  subject_id     INTEGER NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  video_id       TEXT NOT NULL,
  channel_id     TEXT NOT NULL,
  channel_title  TEXT,
  found_at       TEXT NOT NULL,
  PRIMARY KEY (subject_id, video_id)
) WITHOUT ROWID;

CREATE TABLE passed_over_videos (
  video_id  TEXT PRIMARY KEY,
  reason    TEXT NOT NULL,
  noted_at  TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX passed_over_noted ON passed_over_videos (noted_at);
`,
  // 4: two kinds of search for each subject. "Top recent" keeps the columns
  // there already (`every_hours`, `last_searched_at`); "newest" gets its own
  // cadence, its own last run, the moment its last sweep reached and the
  // interval it is on now, which shortens while its sweeps come back full. A
  // hit says how it was made: the kind of search, the place in its results and
  // the video's age then. Hits are rebuilt for that, with the kind in the key
  // and the subject optional, since a video found on a followed channel has
  // none; earlier hits came from most-viewed searches and are kept as such.
  `
ALTER TABLE subjects ADD COLUMN newest_every_hours INTEGER NOT NULL DEFAULT 24;
ALTER TABLE subjects ADD COLUMN newest_interval_hours REAL;
ALTER TABLE subjects ADD COLUMN newest_last_at TEXT;
ALTER TABLE subjects ADD COLUMN newest_swept_to TEXT;

CREATE TABLE subject_hits_next (
  subject_id     INTEGER REFERENCES subjects (id) ON DELETE CASCADE,
  video_id       TEXT NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  rank           INTEGER,
  age_hours      REAL,
  first_seen_at  TEXT NOT NULL
);
INSERT INTO subject_hits_next (subject_id, video_id, kind, first_seen_at)
  SELECT subject_id, video_id, 'top_recent', first_seen_at FROM subject_hits;
DROP TABLE subject_hits;
ALTER TABLE subject_hits_next RENAME TO subject_hits;
CREATE UNIQUE INDEX subject_hits_once ON subject_hits (COALESCE(subject_id, 0), video_id, kind);
CREATE INDEX subject_hits_video ON subject_hits (video_id);

CREATE TABLE pending_hits_next (
  subject_id     INTEGER NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  video_id       TEXT NOT NULL,
  kind           TEXT NOT NULL,
  rank           INTEGER,
  channel_id     TEXT NOT NULL,
  channel_title  TEXT,
  found_at       TEXT NOT NULL,
  PRIMARY KEY (subject_id, video_id, kind)
) WITHOUT ROWID;
INSERT INTO pending_hits_next (subject_id, video_id, kind, channel_id, channel_title, found_at)
  SELECT subject_id, video_id, 'top_recent', channel_id, channel_title, found_at FROM pending_hits;
DROP TABLE pending_hits;
ALTER TABLE pending_hits_next RENAME TO pending_hits;
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

/** Whether the store holds anything worth keeping: a row in any of its tables. */
function hasData(db: Db): boolean {
  const tables = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  // The names come from the store's own list of tables, quoted as identifiers.
  return tables.some(
    ({ name }) =>
      db.prepare(`SELECT 1 FROM "${name.replaceAll('"', '""')}" LIMIT 1`).get() !== undefined,
  );
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

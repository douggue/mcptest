import Database from 'better-sqlite3';
import type { Transact } from '../repos/types';

export type Db = Database.Database;

/**
 * Applied in order; SQLite's `user_version` records how many have run.
 * Never edit a migration that has shipped: add another after it.
 */
const MIGRATIONS: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS channels (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  handle        TEXT,
  handle_lower  TEXT,
  subscribers   INTEGER,
  subs_hidden   INTEGER NOT NULL,
  video_count   INTEGER,
  fetched_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS channels_handle_lower ON channels (handle_lower);

CREATE TABLE IF NOT EXISTS videos (
  id                   TEXT PRIMARY KEY,
  channel_id           TEXT NOT NULL REFERENCES channels (id),
  title                TEXT NOT NULL,
  views                INTEGER NOT NULL,
  duration_s           INTEGER,
  published_at         TEXT NOT NULL,
  published_precision  TEXT NOT NULL,
  published_raw        TEXT NOT NULL,
  fetched_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS videos_channel_published ON videos (channel_id, published_at);

CREATE TABLE IF NOT EXISTS video_snapshots (
  video_id     TEXT NOT NULL REFERENCES videos (id),
  captured_at  TEXT NOT NULL,
  views        INTEGER NOT NULL,
  PRIMARY KEY (video_id, captured_at)
);

CREATE TABLE IF NOT EXISTS edge_crawls (
  channel_id  TEXT PRIMARY KEY REFERENCES channels (id),
  region      TEXT NOT NULL,
  crawled_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rec_edges (
  from_channel  TEXT NOT NULL REFERENCES channels (id),
  to_channel    TEXT NOT NULL,
  hits          INTEGER NOT NULL,
  sampled       INTEGER NOT NULL,
  share         REAL NOT NULL,
  PRIMARY KEY (from_channel, to_channel)
);
CREATE INDEX IF NOT EXISTS rec_edges_to ON rec_edges (to_channel);

CREATE TABLE IF NOT EXISTS maps (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  center_channel  TEXT NOT NULL REFERENCES channels (id),
  depth           INTEGER NOT NULL,
  region          TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS map_channels (
  map_id      INTEGER NOT NULL REFERENCES maps (id),
  channel_id  TEXT NOT NULL REFERENCES channels (id),
  steps       INTEGER NOT NULL,
  position    INTEGER NOT NULL,
  PRIMARY KEY (map_id, channel_id)
);
`,
  `
ALTER TABLE maps ADD COLUMN snapshot_json TEXT;

CREATE TABLE IF NOT EXISTS map_removals (
  center_channel  TEXT NOT NULL REFERENCES channels (id),
  channel_id      TEXT NOT NULL,
  removed_at      TEXT NOT NULL,
  PRIMARY KEY (center_channel, channel_id)
);
`,
  // 3: the channel the owner wants to be like, which a map is measured against.
  `ALTER TABLE maps ADD COLUMN model_channel TEXT;`,
  // 4: small rising channels the owner marked as niches to watch, whatever map they came from.
  `
CREATE TABLE IF NOT EXISTS niche_watchlist (
  channel_id  TEXT PRIMARY KEY REFERENCES channels (id),
  watched_at  TEXT NOT NULL
);
`,
  // 5: channels the owner pulled in as competitors although the filter left them out.
  `
CREATE TABLE IF NOT EXISTS map_keeps (
  center_channel  TEXT NOT NULL REFERENCES channels (id),
  channel_id      TEXT NOT NULL,
  kept_at         TEXT NOT NULL,
  PRIMARY KEY (center_channel, channel_id)
);
`,
  // 6: each finished refresh of the stored channels, so the screen can say when the last one ran.
  `
CREATE TABLE IF NOT EXISTS refresh_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at     TEXT NOT NULL,
  finished_at    TEXT NOT NULL,
  refreshed      INTEGER NOT NULL,
  failed         INTEGER NOT NULL,
  stopped_early  INTEGER NOT NULL
);
`,
  // 7: channel facts from the official API: the exact creation date, the country and total views.
  `
ALTER TABLE channels ADD COLUMN created_at TEXT;
ALTER TABLE channels ADD COLUMN country TEXT;
ALTER TABLE channels ADD COLUMN total_views INTEGER;
ALTER TABLE channels ADD COLUMN facts_fetched_at TEXT;
`,
  // 8: reads of a channel that failed in a row, so a refresh stops retrying one that is gone.
  `
ALTER TABLE channels ADD COLUMN read_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN read_failed_at TEXT;
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
    throw new Error('This store was made by a newer version of Jgtube. Update Jgtube to open it.');
  }
  steps.forEach((sql, index) => {
    db.transaction(() => {
      if (version() > index) return;
      db.exec(sql);
      db.pragma(`user_version = ${index + 1}`);
    }).immediate();
  });
}

/** Opens the store and brings its tables up to date. Pass ":memory:" for tests. */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function transactionRunner(db: Db): Transact {
  return (work) => {
    db.transaction(work)();
  };
}

import Database from 'better-sqlite3';
import type { Transact } from '../repos/types';

export type Db = Database.Database;

const SCHEMA = `
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
`;

/** Opens the store and creates any missing tables. Pass ":memory:" for tests. */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function transactionRunner(db: Db): Transact {
  return (work) => {
    db.transaction(work)();
  };
}

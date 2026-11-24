import Database from 'better-sqlite3';
import type { Transact } from '../repos/types';
import { backupStore, isFileStore } from './backup';

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
  // 9: the right to read YouTube, held by one piece of work at a time across every program.
  `
CREATE TABLE IF NOT EXISTS work_leases (
  name        TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
`,
  // 10: ideas the owner saved as transfer opportunities, kept by the words of their title so
  //     they stay listed whatever is crawled later; and an index for reading recent videos
  //     across every channel, which the transfer list does on each read.
  `
CREATE TABLE IF NOT EXISTS transfer_saves (
  idea_key  TEXT PRIMARY KEY,
  template  TEXT NOT NULL,
  saved_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS videos_published ON videos (published_at);
`,
  // 11: what is read from a video's own page, kept so that each is read once: its captions
  //     (a row with no lines means it had none when asked), its description and tags, and
  //     its storyboard. None of them refers to the videos table: a video can be read by its
  //     id before any crawl has stored it. And how a channel presents itself (logo, cover,
  //     bio, keywords, links), in columns the facts from the official API do not share.
  `
CREATE TABLE IF NOT EXISTS video_transcripts (
  video_id        TEXT PRIMARY KEY,
  language        TEXT,
  auto_generated  INTEGER NOT NULL DEFAULT 0,
  segments_json   TEXT,
  fetched_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_details (
  video_id     TEXT PRIMARY KEY,
  title        TEXT,
  description  TEXT NOT NULL,
  tags_json    TEXT NOT NULL,
  duration_s   INTEGER,
  source       TEXT NOT NULL,
  fetched_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_storyboards (
  video_id     TEXT PRIMARY KEY,
  levels_json  TEXT NOT NULL,
  fetched_at   TEXT NOT NULL
);

ALTER TABLE channels ADD COLUMN description TEXT;
ALTER TABLE channels ADD COLUMN avatar_json TEXT;
ALTER TABLE channels ADD COLUMN banner_json TEXT;
ALTER TABLE channels ADD COLUMN keywords_json TEXT;
ALTER TABLE channels ADD COLUMN links_json TEXT;
ALTER TABLE channels ADD COLUMN brand_fetched_at TEXT;
`,
  // 12: what an engine wrote down about a video, one row per video and kind: 'watch' is
  //     what it saw and heard watching the whole video, 'frames' is what the preview frames
  //     show from start to end, with where those frames came from ('file' or 'preview') and
  //     how many there were to look at. Kept because each costs minutes of an engine's time.
  //     Like the tables of step 11 it does not refer to the videos table.
  `
CREATE TABLE IF NOT EXISTS video_studies (
  video_id          TEXT NOT NULL,
  kind              TEXT NOT NULL,
  engine            TEXT NOT NULL,
  notes             TEXT NOT NULL,
  frame_source      TEXT,
  frames_available  INTEGER,
  studied_at        TEXT NOT NULL,
  PRIMARY KEY (video_id, kind)
);
`,
  // 13: the idea lab. A batch is what one run of concepts rests on: the centre channel it
  //     is for, the videos the owner picked, the title format (from the transfer list or a
  //     stored formula, with its text as it read then), the owner's angle and the length.
  //     A concept is one title with its alternates, thumbnail brief, overlay and hook; a
  //     twist or a more-like-this names the concept it came from. A title formula is a
  //     pattern an engine saw across several breakout titles of one channel's map, kept
  //     per centre channel and window of days. A hook label is the name an engine gave to
  //     the way one breakout video opens (the opening words themselves are cut from the
  //     stored captions each time, never stored twice). All four are read through their
  //     centre channel only: a store holds several niches, and one's ideas are not another's.
  `
CREATE TABLE IF NOT EXISTS concept_batches (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  center_channel_id  TEXT NOT NULL,
  inspiration_json   TEXT NOT NULL,
  hook_models_json   TEXT NOT NULL DEFAULT '[]',
  format_source      TEXT,
  format_ref         TEXT,
  format_template    TEXT,
  angle              TEXT,
  length             TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS concept_batches_by_center ON concept_batches (center_channel_id);

CREATE TABLE IF NOT EXISTS concepts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id         INTEGER NOT NULL REFERENCES concept_batches (id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  alt_title_1      TEXT NOT NULL,
  alt_title_2      TEXT NOT NULL,
  thumbnail        TEXT NOT NULL,
  overlay          TEXT NOT NULL,
  hook             TEXT NOT NULL,
  hook_style       TEXT,
  rests_on         TEXT NOT NULL,
  needs            TEXT NOT NULL,
  origin           TEXT NOT NULL,
  parent_id        INTEGER,
  engine           TEXT NOT NULL,
  kept             INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS concepts_by_batch ON concepts (batch_id);

CREATE TABLE IF NOT EXISTS title_formulas (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  center_channel_id  TEXT NOT NULL,
  window_days        INTEGER NOT NULL,
  formula            TEXT NOT NULL,
  why                TEXT NOT NULL,
  video_ids_json     TEXT NOT NULL,
  engine             TEXT NOT NULL,
  run_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS title_formulas_by_center
  ON title_formulas (center_channel_id, window_days);

CREATE TABLE IF NOT EXISTS hook_labels (
  center_channel_id  TEXT NOT NULL,
  video_id           TEXT NOT NULL,
  style              TEXT NOT NULL,
  how                TEXT NOT NULL,
  engine             TEXT NOT NULL,
  labelled_at        TEXT NOT NULL,
  PRIMARY KEY (center_channel_id, video_id)
);
`,
  // 14: the script writer. One script per concept: where it stands, the voice it is
  //     written in (a channel, its speaking rate, the length aimed at, the reading grade
  //     the tighten pass aims at), the library hooks chosen as models, the hooks the first
  //     stage wrote, the hook the owner picked, the beat sheet, the draft and the tightened
  //     draft. It belongs to its concept and goes with it, and so to one centre channel.
  `
CREATE TABLE IF NOT EXISTS scripts (
  concept_id        INTEGER PRIMARY KEY REFERENCES concepts (id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'idea',
  voice_channel_id  TEXT,
  words_per_minute  INTEGER,
  target_seconds    INTEGER,
  target_grade      REAL,
  hook_models_json  TEXT NOT NULL DEFAULT '[]',
  hooks_json        TEXT NOT NULL DEFAULT '[]',
  chosen_hook       TEXT NOT NULL DEFAULT '',
  beats             TEXT NOT NULL DEFAULT '',
  draft             TEXT NOT NULL DEFAULT '',
  tightened         TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL
);
`,
  // 15: the parts of a channel's breakdown, one row per channel and part: the text an engine
  //     wrote (notes) with who wrote it, or why the part could not be written (problem). A
  //     new run replaces a row. Kept so that a finished breakdown opens again without being
  //     run again. Like the table of step 12 it refers to no other table, and it
  //     needs nothing a later step adds.
  `
CREATE TABLE IF NOT EXISTS breakdown_parts (
  channel_id  TEXT NOT NULL,
  part        TEXT NOT NULL,
  engine      TEXT,
  notes       TEXT,
  problem     TEXT,
  written_at  TEXT NOT NULL,
  PRIMARY KEY (channel_id, part)
);
`,
  // 16: the place the owner chose for a channel of theirs, one row per centre channel:
  //     a place's key as the place list has it. With a row, the transfer list is judged
  //     for that place instead of the one read from the channel's titles or its country.
  //     It refers to no other table, so it outlives a deleted map and a re-read channel.
  `
CREATE TABLE IF NOT EXISTS owner_places (
  center_channel_id  TEXT PRIMARY KEY,
  place_key          TEXT NOT NULL,
  set_at             TEXT NOT NULL
);
`,
  // 17: when the owner last marked a channel's "what changed" as seen, one row per centre
  //     channel. It refers to no other table and needs nothing a later step adds.
  `
CREATE TABLE IF NOT EXISTS channel_looks (
  center_channel_id  TEXT PRIMARY KEY,
  seen_at            TEXT NOT NULL
);
`,
  // 18: what an engine wrote for a channel that is kept to be read again, one row per
  //     channel and kind: a thumbnail review (with its ready prompt), a quick analysis's
  //     answer, the style lock lifted out of a breakdown. A new run replaces a row. Like
  //     the tables of steps 12, 15, 16 and 17 it refers to no other table.
  `
CREATE TABLE IF NOT EXISTS channel_notes (
  channel_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  engine      TEXT NOT NULL,
  notes       TEXT NOT NULL,
  written_at  TEXT NOT NULL,
  PRIMARY KEY (channel_id, kind)
);
`,
  // 19: the thumbnail prompt written for one concept: the prompt, why that style, and
  //     the videos whose thumbnails it was learned from. It belongs to its concept and
  //     goes with it (step 13), and so to one centre channel. A new run replaces it.
  `
CREATE TABLE IF NOT EXISTS concept_thumbnails (
  concept_id      INTEGER PRIMARY KEY REFERENCES concepts (id) ON DELETE CASCADE,
  prompt          TEXT NOT NULL,
  why             TEXT NOT NULL DEFAULT '',
  video_ids_json  TEXT NOT NULL DEFAULT '[]',
  engine          TEXT NOT NULL,
  written_at      TEXT NOT NULL
);
`,
  // 20: alerts. One rule
  //     per centre channel (the owner's number for a look-alike video's outlier score, whether a look-alike newly taking off counts, on or off, and when it
  //     was last checked) and the alerts found, each kept once per channel, kind and subject.
  //     They refer to no other table and need nothing a later step adds.
  `
CREATE TABLE IF NOT EXISTS alert_rules (
  center_channel_id  TEXT PRIMARY KEY,
  min_score          REAL NOT NULL,
  taken_off          INTEGER NOT NULL,
  enabled            INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  checked_at         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  center_channel_id  TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('breakout', 'taken-off')),
  subject_id         TEXT NOT NULL,
  channel_id         TEXT NOT NULL,
  channel_title      TEXT NOT NULL,
  video_title        TEXT,
  score              REAL,
  views              INTEGER,
  found_at           TEXT NOT NULL,
  read_at            TEXT,
  UNIQUE (center_channel_id, kind, subject_id)
);
`,
  // 21: the published video a
  //     kept concept became, one per concept, pasted by the owner and
  //     checked to be a video of the concept's centre channel. A video is linked to one concept
  //     of a channel at most. It refers only to concepts (step 13) and goes with its concept.
  `
CREATE TABLE IF NOT EXISTS concept_videos (
  concept_id         INTEGER PRIMARY KEY REFERENCES concepts (id) ON DELETE CASCADE,
  center_channel_id  TEXT NOT NULL,
  video_id           TEXT NOT NULL,
  linked_at          TEXT NOT NULL,
  UNIQUE (center_channel_id, video_id)
);
`,
  // 22: the upload calendar. A kept concept's planned
  //     date and the status the owner set for it when the concept has no script (a script
  //     keeps its own), or "published". Both may be empty. It refers only to concepts (13).
  `
CREATE TABLE IF NOT EXISTS concept_schedule (
  concept_id         INTEGER PRIMARY KEY REFERENCES concepts (id) ON DELETE CASCADE,
  center_channel_id  TEXT NOT NULL,
  status             TEXT CHECK (status IN ('idea', 'drafting', 'ready', 'published')),
  planned_date       TEXT,
  updated_at         TEXT NOT NULL
);
`,
  // 23: comment mining. The top-level comments read for a
  //     video from the official API (text, likes, when written; never who wrote them), when
  //     each video was read and whether its comments were turned off, and each centre
  //     channel's latest "What viewers ask for" answer as checked in code. They refer to no
  //     other table and need nothing a later step adds.
  `
CREATE TABLE IF NOT EXISTS video_comments (
  comment_id    TEXT PRIMARY KEY,
  video_id      TEXT NOT NULL,
  text          TEXT NOT NULL,
  likes         INTEGER NOT NULL,
  published_at  TEXT NOT NULL,
  fetched_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS video_comments_video ON video_comments (video_id);
CREATE TABLE IF NOT EXISTS comment_reads (
  video_id  TEXT PRIMARY KEY,
  status    TEXT NOT NULL CHECK (status IN ('read', 'disabled')),
  count     INTEGER NOT NULL,
  read_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comment_answers (
  center_channel_id  TEXT PRIMARY KEY,
  video_ids_json     TEXT NOT NULL,
  findings_json      TEXT NOT NULL,
  engine             TEXT NOT NULL,
  asked_at           TEXT NOT NULL
);
`,
  // 24: the risk check before publishing. One row per kept
  //     concept: the claims and overlap notes an engine gave, as checked in code, who gave
  //     them, when, and when the script had last changed then. What code works out (overlaps,
  //     unchecked facts) is not kept: it is worked out again at each look. It refers only to
  //     concepts (step 13) and goes with its concept.
  `
CREATE TABLE IF NOT EXISTS risk_checks (
  concept_id         INTEGER PRIMARY KEY REFERENCES concepts (id) ON DELETE CASCADE,
  center_channel_id  TEXT NOT NULL,
  claims_json        TEXT NOT NULL,
  notes_json         TEXT NOT NULL,
  engine             TEXT NOT NULL,
  checked_at         TEXT NOT NULL,
  script_updated_at  TEXT NOT NULL
);
`,
  // 25: the script writer's research. concept_research keeps the fact sheet a web research run wrote
  //     for a concept (facts with their https sources, what was not found, what is
  //     disputed); script_claims keeps the claims check's verdict on each fact a script
  //     marked to check; script_lengths keeps the length the owner typed, in minutes or in
  //     words. Each refers only to concepts (step 13) and goes with its concept.
  `
CREATE TABLE IF NOT EXISTS concept_research (
  concept_id      INTEGER PRIMARY KEY REFERENCES concepts (id) ON DELETE CASCADE,
  facts_json      TEXT NOT NULL,
  not_found_json  TEXT NOT NULL DEFAULT '[]',
  disputed_json   TEXT NOT NULL DEFAULT '[]',
  engine          TEXT NOT NULL,
  written_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS script_claims (
  concept_id    INTEGER NOT NULL REFERENCES concepts (id) ON DELETE CASCADE,
  what          TEXT NOT NULL,
  sentence      TEXT NOT NULL,
  verdict       TEXT NOT NULL CHECK (verdict IN ('confirmed', 'wrong', 'unsure')),
  why           TEXT NOT NULL DEFAULT '',
  correction    TEXT,
  sources_json  TEXT NOT NULL DEFAULT '[]',
  engine        TEXT NOT NULL,
  checked_at    TEXT NOT NULL,
  PRIMARY KEY (concept_id, what, sentence)
);
CREATE TABLE IF NOT EXISTS script_lengths (
  concept_id  INTEGER PRIMARY KEY REFERENCES concepts (id) ON DELETE CASCADE,
  typed       TEXT NOT NULL CHECK (typed IN ('minutes', 'words')),
  words       INTEGER,
  updated_at  TEXT NOT NULL
);
`,
  // 26: the per-video thumbnail review.
  //     thumbnail_tags keeps the fixed checklist an engine filled in for one thumbnail, as
  //     checked in code, reused by every later review; thumbnail_reviews keeps, per centre
  //     channel and video, the comparison code counted and the answer written from it. They
  //     refer to no other table and need nothing a later step adds.
  `
CREATE TABLE IF NOT EXISTS thumbnail_tags (
  video_id   TEXT PRIMARY KEY,
  tags_json  TEXT NOT NULL,
  engine     TEXT NOT NULL,
  tagged_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS thumbnail_reviews (
  center_channel_id  TEXT NOT NULL,
  video_id           TEXT NOT NULL,
  comparison_json    TEXT NOT NULL,
  compared_at        TEXT NOT NULL,
  answer_text        TEXT,
  prompt             TEXT,
  engine             TEXT,
  written_at         TEXT,
  PRIMARY KEY (center_channel_id, video_id)
);
`,
  // 27: the public signs of a channel's earning.
  //     channel_money_signs keeps, per channel, what one read of one of its watch pages
  //     showed: a Join button (memberships, which need the Partner Program) and whether ads
  //     were listed ('unknown' when YouTube would not play the video), and when. A new
  //     check replaces the row. It refers to no other table and needs nothing a later
  //     step adds.
  `
CREATE TABLE IF NOT EXISTS channel_money_signs (
  channel_id   TEXT PRIMARY KEY,
  video_id     TEXT NOT NULL,
  memberships  INTEGER NOT NULL CHECK (memberships IN (0, 1)),
  ads          TEXT NOT NULL CHECK (ads IN ('shown', 'none', 'unknown')),
  checked_at   TEXT NOT NULL
);
`,
  // 28: deep breakdowns of one video
  //     each, one row per video. video_id is a YouTube id, or the id a file the owner gave
  //     was saved under (same shape). seen_json is how the video was seen, recorded in code;
  //     notes is what an engine wrote, problem why nothing could be. A new run replaces the
  //     row. Like the tables of steps 12 and 15 it refers to no other table.
  `
CREATE TABLE IF NOT EXISTS video_breakdowns (
  video_id    TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  title       TEXT NOT NULL,
  channel_id  TEXT,
  seen_json   TEXT NOT NULL,
  engine      TEXT,
  notes       TEXT,
  problem     TEXT,
  written_at  TEXT NOT NULL
);
`,
  // 29: the production teardown of one video.
  //     video_teardown_parts keeps, per video and part, what code measured or an engine
  //     judged as JSON (or why it could not be made), so a later run, a channel breakdown
  //     or the page reuses it. The pictures it names live under <downloads>/teardowns/<id>/.
  //     It refers to no other table and needs nothing a later step adds.
  `
CREATE TABLE IF NOT EXISTS video_teardown_parts (
  video_id  TEXT NOT NULL,
  part      TEXT NOT NULL,
  engine    TEXT,
  json      TEXT,
  problem   TEXT,
  made_at   TEXT NOT NULL,
  PRIMARY KEY (video_id, part)
);
`,
  // 30: what a reader of a written breakdown part should know about how it was written, as
  //     JSON: another engine wrote it because the one the owner chose could not, or it was
  //     written from pictures handed over as files and names none of them. Empty for most.
  `ALTER TABLE breakdown_parts ADD COLUMN caveat_json TEXT;`,
  // 31: the format builder's shelf.
  //     format_ingredients keeps each piece of a format the owner took from a source: its
  //     layer, a short name, where it came from (kind and key, unique per layer), the
  //     channels it comes from, what the source holds (details), what code counted
  //     (evidence) and pictures or quotes (media), all as JSON checked again when read.
  //     It refers to no other table and needs nothing a later step adds.
  `
CREATE TABLE IF NOT EXISTS format_ingredients (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  layer              TEXT NOT NULL,
  name               TEXT NOT NULL,
  source_kind        TEXT NOT NULL,
  source_key         TEXT NOT NULL,
  source_label       TEXT NOT NULL,
  center_channel_id  TEXT,
  channel_ids_json   TEXT NOT NULL,
  details_json       TEXT NOT NULL,
  evidence_json      TEXT NOT NULL,
  media_json         TEXT NOT NULL,
  note               TEXT NOT NULL DEFAULT '',
  added_at           TEXT NOT NULL,
  UNIQUE (layer, source_kind, source_key)
);
`,
];

/** The number of the newest step: what `user_version` reads in a store that is up to date. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;

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
function backupBeforeUpdating(db: Db, path: string, now: Date): void {
  const version = Number(db.pragma('user_version', { simple: true }));
  if (!isFileStore(path) || version >= MIGRATIONS.length || !hasData(db)) return;
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
 * that holds data and needs updating. Pass ":memory:" for tests.
 */
export function openDatabase(path: string, now: Date = new Date()): Db {
  const db = new Database(path);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    backupBeforeUpdating(db, path, now);
    migrate(db);
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

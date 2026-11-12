// SQLite (built into Node 22) shared by the web and engine processes. WAL mode lets both
// read and write the same file safely.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const config = require('./config');

const db = new DatabaseSync(config.DB_FILE);
// busy_timeout first: the web and engine processes open the database at the same moment.
db.exec('PRAGMA busy_timeout = 10000');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  mfa_ok INTEGER NOT NULL DEFAULT 0, ip TEXT, agent TEXT
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, original_file TEXT NOT NULL, original_name TEXT,
  size INTEGER, duration REAL, width INTEGER, height INTEGER, vcodec TEXT, acodec TEXT, fps REAL,
  orientation TEXT, status TEXT NOT NULL DEFAULT 'uploaded', error TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY, media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  profile TEXT NOT NULL, fit TEXT NOT NULL DEFAULT 'blur', quality TEXT NOT NULL DEFAULT '1080',
  file TEXT, size INTEGER, status TEXT NOT NULL DEFAULT 'queued', progress REAL DEFAULT 0, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER,
  UNIQUE (media_id, profile)
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, items TEXT NOT NULL DEFAULT '[]',
  shuffle INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL, server_url TEXT NOT NULL,
  key_enc TEXT, enabled INTEGER NOT NULL DEFAULT 1, authorized INTEGER NOT NULL DEFAULT 0,
  allow_prerecorded INTEGER NOT NULL DEFAULT 1, max_bitrate INTEGER, notes TEXT,
  last_test TEXT, created_at INTEGER NOT NULL, updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL, orientation TEXT NOT NULL,
  destination_ids TEXT NOT NULL DEFAULT '[]', schedule TEXT NOT NULL, duration_min REAL,
  loop INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1, cursor INTEGER,
  ingest_key TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, broadcast_id TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  scheduled_for INTEGER NOT NULL, trigger TEXT NOT NULL, state TEXT NOT NULL, reason TEXT,
  started_at INTEGER, live_at INTEGER, ends_at INTEGER, ended_at INTEGER, error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (broadcast_id, scheduled_for)
);
CREATE INDEX IF NOT EXISTS runs_state ON runs(state);

CREATE TABLE IF NOT EXISTS run_outputs (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, destination_id TEXT NOT NULL,
  state TEXT NOT NULL, retries INTEGER NOT NULL DEFAULT 0, started_at INTEGER, ended_at INTEGER,
  last_error TEXT, bytes INTEGER DEFAULT 0,
  PRIMARY KEY (run_id, destination_id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, level TEXT NOT NULL,
  category TEXT NOT NULL, message TEXT NOT NULL, ref TEXT
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY, filename TEXT NOT NULL, size INTEGER NOT NULL, received INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const newId = (bytes = 8) => crypto.randomBytes(bytes).toString('hex');

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const DEFAULT_PREFS = {
  timezone: 'America/New_York',
  quality: '1080',            // 1080 or 720 prepared variants
  autoPrepare: 'native',      // 'native' or 'both' formats on upload
  defaultFit: 'blur',         // blur | pad | crop when converting between 16:9 and 9:16
  missedWindowMin: 15,        // start a late broadcast only within this many minutes
  maxConcurrent: 2,           // simultaneous broadcasts
  maxRetries: 3,              // per-destination reconnect attempts
  webhookUrl: '',             // Discord / Slack / ntfy / generic JSON
};

function getSetting(key, fallback = null) {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  return r ? JSON.parse(r.value) : fallback;
}
function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}
function prefs() { return { ...DEFAULT_PREFS, ...(getSetting('prefs') || {}) }; }

function logEvent(level, category, message, ref = null) {
  run('INSERT INTO events (ts, level, category, message, ref) VALUES (?, ?, ?, ?, ?)', Date.now(), level, category, String(message).slice(0, 2000), ref);
  run('DELETE FROM events WHERE ts < ?', Date.now() - 60 * 24 * 3600 * 1000);
}

// Row mappers turn JSON columns into objects.
const mappers = {
  broadcast: (b) => b && ({
    ...b, source: JSON.parse(b.source), destination_ids: JSON.parse(b.destination_ids),
    schedule: JSON.parse(b.schedule), loop: !!b.loop, enabled: !!b.enabled,
  }),
  playlist: (p) => p && ({ ...p, items: JSON.parse(p.items), shuffle: !!p.shuffle }),
  destination: (d) => d && ({ ...d, enabled: !!d.enabled, authorized: !!d.authorized, allow_prerecorded: !!d.allow_prerecorded, last_test: d.last_test ? JSON.parse(d.last_test) : null }),
};

module.exports = { db, all, get, run, tx, newId, getSetting, setSetting, prefs, DEFAULT_PREFS, logEvent, mappers };

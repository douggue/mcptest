import type { Db } from '../db/sqlite';
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from '../sources/parse';

/**
 * Deep breakdowns of one video each, one row per video: a YouTube video by
 * its id, or a file the owner gave by the id it was saved under. The row
 * keeps how the video was seen (worked out in code), and the text an engine
 * wrote or why none could be written. A new run replaces the row.
 *
 * The text is a model's words about a video anyone could have made: stored
 * and handed out as it is, never used as instructions.
 */

/** The most characters kept for one breakdown; the answer asked for is far shorter. */
export const MAX_VIDEO_BREAKDOWN_CHARS = 60_000;
const MAX_TITLE_CHARS = 200;
const MAX_ENGINE_NAME_LENGTH = 40;
const MAX_REASON_CHARS = 500;
const MAX_NOTES = 12;
const MAX_NOTE_CHARS = 300;
/** The most breakdowns listed: enough for the owner's history, small enough to send at once. */
const LIST_LIMIT = 200;

/** Where the video came from. */
export type VideoSource = 'youtube' | 'file';

/** How the video was seen, as code recorded it: the page says this beside the answer. */
export interface VideoSeen {
  /** The file studied: the owner's own copy, one downloaded, one given here, or none. */
  readonly file: 'own' | 'downloaded' | 'uploaded' | 'none';
  /** Why there was no file, when there was none. */
  readonly fileNote: string | null;
  /** The engine that watched it, picture and sound; null when nothing watched it. */
  readonly watchedBy: string | null;
  /** The engine that went through its frames; null when no frame study was made. */
  readonly framesBy: string | null;
  readonly frameSource: 'file' | 'preview' | null;
  /** How many frames there were to look at; null when unknown. */
  readonly frames: number | null;
  /** Its captions: read, none on YouTube, could not be read, or not asked (a file). */
  readonly captions: 'read' | 'none' | 'failed' | 'not-asked';
  /** What could not be done, one plain sentence each. */
  readonly notes: readonly string[];
}

export type NewVideoBreakdown = {
  readonly videoId: string;
  readonly source: VideoSource;
  readonly title: string;
  /** The channel that published it, when known and stored; null for a file. */
  readonly channelId: string | null;
  readonly seen: VideoSeen;
} & (
  | { readonly written: { readonly engine: string; readonly text: string } }
  | { readonly problem: string }
);

export interface StoredVideoBreakdown {
  readonly videoId: string;
  readonly source: VideoSource;
  readonly title: string;
  readonly channelId: string | null;
  readonly seen: VideoSeen;
  /** What was written and by which engine; null when it could not be. */
  readonly written: { readonly engine: string; readonly text: string } | null;
  /** Why it could not be written; null when it was. */
  readonly problem: string | null;
  readonly writtenAt: Date;
}

export interface VideoBreakdownRepo {
  /** Every kept breakdown, the newest first. */
  list(): readonly StoredVideoBreakdown[];
  /** Null when the video was never broken down. */
  find(videoId: string): StoredVideoBreakdown | null;
  /** Replaces what was kept for the video. Throws for a bad id, channel, engine or an empty text. */
  save(entry: NewVideoBreakdown, at: Date): void;
}

interface Row {
  video_id: string;
  source: string;
  title: string;
  channel_id: string | null;
  seen_json: string;
  engine: string | null;
  notes: string | null;
  problem: string | null;
  written_at: string;
}

const COLUMNS =
  'video_id, source, title, channel_id, seen_json, engine, notes, problem, written_at';

const NOTHING_SEEN: VideoSeen = {
  file: 'none',
  fileNote: null,
  watchedBy: null,
  framesBy: null,
  frameSource: null,
  frames: null,
  captions: 'not-asked',
  notes: [],
};

const textOr = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.find((entry) => entry === value) ?? fallback;

/** The stored facts of how a video was seen; anything unreadable counts as nothing seen. */
function seenOf(json: string): VideoSeen {
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return NOTHING_SEEN;
    raw = parsed as Record<string, unknown>;
  } catch {
    return NOTHING_SEEN;
  }
  const frames = raw['frames'];
  const notes = raw['notes'];
  return {
    file: oneOf(raw['file'], ['own', 'downloaded', 'uploaded', 'none'], 'none'),
    fileNote: textOr(raw['fileNote']),
    watchedBy: textOr(raw['watchedBy']),
    framesBy: textOr(raw['framesBy']),
    frameSource:
      raw['frameSource'] === 'file' || raw['frameSource'] === 'preview' ? raw['frameSource'] : null,
    frames: typeof frames === 'number' && Number.isInteger(frames) && frames > 0 ? frames : null,
    captions: oneOf(raw['captions'], ['read', 'none', 'failed', 'not-asked'], 'not-asked'),
    notes: Array.isArray(notes)
      ? notes.filter((note): note is string => typeof note === 'string')
      : [],
  };
}

/** A row as a kept breakdown; null for one something else wrote badly. */
function entryOf(row: Row): StoredVideoBreakdown | null {
  const writtenAt = new Date(row.written_at);
  if (Number.isNaN(writtenAt.getTime())) return null;
  if (row.source !== 'youtube' && row.source !== 'file') return null;
  const written =
    row.notes !== null && row.notes.trim() !== '' && row.engine !== null
      ? { engine: row.engine, text: row.notes }
      : null;
  const problem = row.problem !== null && row.problem.trim() !== '' ? row.problem : null;
  if (written === null && problem === null) return null;
  return {
    videoId: row.video_id,
    source: row.source,
    title: row.title,
    channelId: row.channel_id,
    seen: seenOf(row.seen_json),
    written,
    problem: written === null ? problem : null,
    writtenAt,
  };
}

/** The facts kept as they were recorded, capped so a bad caller cannot fill the store. */
function cappedSeen(seen: VideoSeen): VideoSeen {
  const cap = (text: string | null): string | null =>
    text === null ? null : text.slice(0, MAX_NOTE_CHARS);
  return {
    ...seen,
    fileNote: cap(seen.fileNote),
    notes: seen.notes.slice(0, MAX_NOTES).map((note) => note.slice(0, MAX_NOTE_CHARS)),
  };
}

function check(entry: NewVideoBreakdown): void {
  if (!VIDEO_ID_PATTERN.test(entry.videoId)) {
    throw new Error(`Not a valid video id: "${entry.videoId.slice(0, 40)}"`);
  }
  if (entry.channelId !== null && !CHANNEL_ID_PATTERN.test(entry.channelId)) {
    throw new Error('Not a valid YouTube channel id');
  }
  if (!('written' in entry)) return;
  const engine = entry.written.engine.trim();
  if (engine === '' || engine.length > MAX_ENGINE_NAME_LENGTH) {
    throw new Error('A breakdown needs the name of the engine that wrote it');
  }
  if (entry.written.text.trim() === '') throw new Error('A breakdown cannot be empty');
}

export class SqliteVideoBreakdownRepo implements VideoBreakdownRepo {
  constructor(private readonly db: Db) {}

  list(): readonly StoredVideoBreakdown[] {
    const rows = this.db
      .prepare<[number], Row>(
        `SELECT ${COLUMNS} FROM video_breakdowns ORDER BY written_at DESC, video_id LIMIT ?`,
      )
      .all(LIST_LIMIT);
    return rows.flatMap((row) => entryOf(row) ?? []);
  }

  find(videoId: string): StoredVideoBreakdown | null {
    const row = this.db
      .prepare<[string], Row>(`SELECT ${COLUMNS} FROM video_breakdowns WHERE video_id = ?`)
      .get(videoId);
    return row ? entryOf(row) : null;
  }

  save(entry: NewVideoBreakdown, at: Date): void {
    check(entry);
    const written = 'written' in entry ? entry.written : null;
    this.db
      .prepare(
        `INSERT INTO video_breakdowns (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (video_id) DO UPDATE SET source = excluded.source, title = excluded.title,
           channel_id = excluded.channel_id, seen_json = excluded.seen_json, engine = excluded.engine,
           notes = excluded.notes, problem = excluded.problem, written_at = excluded.written_at`,
      )
      .run(
        entry.videoId,
        entry.source,
        entry.title.slice(0, MAX_TITLE_CHARS),
        entry.channelId,
        JSON.stringify(cappedSeen(entry.seen)),
        written ? written.engine.trim() : null,
        written ? written.text.slice(0, MAX_VIDEO_BREAKDOWN_CHARS) : null,
        'problem' in entry ? entry.problem.slice(0, MAX_REASON_CHARS) : null,
        at.toISOString(),
      );
  }
}

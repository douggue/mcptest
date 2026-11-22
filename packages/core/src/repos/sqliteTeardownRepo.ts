import type { Db } from '../db/sqlite';
import { VIDEO_ID_PATTERN } from '../sources/parse';

/**
 * The parts of one video's production teardown, one row per video and part:
 * the measurements made in code, the transcript it rests on, the chapter
 * sheets, and each judged stage as checked JSON with the engine that wrote it,
 * or why it could not be made. Kept so a later run, a channel breakdown or a
 * page reload reuses them instead of starting the same work again.
 *
 * What an engine wrote is a model's words about a video anyone could have
 * made: kept and handed out as data, never used as instructions.
 */

export const TEARDOWN_PARTS = [
  'about',
  'measured',
  'transcript',
  'sheets',
  'structure',
  'watch',
  'hook',
  'design',
  'archetypes',
  'motion',
  'techniques',
  'sound',
  'plan',
] as const;
export type TeardownPart = (typeof TEARDOWN_PARTS)[number];

/** The most characters one part may hold: a transcript of an hour and its timings fits. */
export const MAX_TEARDOWN_PART_CHARS = 2_000_000;
const MAX_ENGINE_LENGTH = 40;
const MAX_PROBLEM_CHARS = 600;
const LIST_LIMIT = 500;

export interface StoredTeardownPart {
  readonly videoId: string;
  readonly part: TeardownPart;
  /** Who made it: an engine, or "jgtube" for what code measured. */
  readonly engine: string | null;
  /** The part as JSON; null when it could not be made. */
  readonly json: string | null;
  readonly problem: string | null;
  readonly madeAt: Date;
}

export type NewTeardownPart =
  { readonly engine: string; readonly json: string } | { readonly problem: string };

export interface TeardownRepo {
  /** Every stored part of one video. */
  parts(videoId: string): readonly StoredTeardownPart[];
  /** One part; null when there is none. */
  find(videoId: string, part: TeardownPart): StoredTeardownPart | null;
  /** Replaces one part. Throws for a bad id, part or engine, or an empty or oversized part. */
  save(videoId: string, part: TeardownPart, entry: NewTeardownPart, at: Date): void;
  /** Removes every part of one video. */
  remove(videoId: string): void;
  /** The videos with a teardown, the most recently changed first. */
  videos(): readonly { readonly videoId: string; readonly updatedAt: Date }[];
}

interface Row {
  video_id: string;
  part: string;
  engine: string | null;
  json: string | null;
  problem: string | null;
  made_at: string;
}

const isPart = (value: string): value is TeardownPart =>
  (TEARDOWN_PARTS as readonly string[]).includes(value);

function partOf(row: Row): StoredTeardownPart | null {
  const madeAt = new Date(row.made_at);
  if (!isPart(row.part) || Number.isNaN(madeAt.getTime())) return null;
  return {
    videoId: row.video_id,
    part: row.part,
    engine: row.engine,
    json: row.json,
    problem: row.json === null ? (row.problem ?? 'It could not be made.') : null,
    madeAt,
  };
}

function check(videoId: string, part: string, entry: NewTeardownPart): void {
  if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error('Not a valid video id');
  if (!isPart(part)) throw new Error('Not a part of a teardown');
  if (!('json' in entry)) return;
  const engine = entry.engine.trim();
  if (engine === '' || engine.length > MAX_ENGINE_LENGTH)
    throw new Error('A part needs who made it');
  if (entry.json.trim() === '' || entry.json.length > MAX_TEARDOWN_PART_CHARS) {
    throw new Error('A part must be some JSON, and not too long');
  }
}

export class SqliteTeardownRepo implements TeardownRepo {
  constructor(private readonly db: Db) {}

  parts(videoId: string): readonly StoredTeardownPart[] {
    return this.db
      .prepare<[string], Row>('SELECT * FROM video_teardown_parts WHERE video_id = ? ORDER BY part')
      .all(videoId)
      .flatMap((row) => partOf(row) ?? []);
  }

  find(videoId: string, part: TeardownPart): StoredTeardownPart | null {
    const row = this.db
      .prepare<[string, string], Row>(
        'SELECT * FROM video_teardown_parts WHERE video_id = ? AND part = ?',
      )
      .get(videoId, part);
    return row === undefined ? null : partOf(row);
  }

  save(videoId: string, part: TeardownPart, entry: NewTeardownPart, at: Date): void {
    check(videoId, part, entry);
    const made = 'json' in entry;
    this.db
      .prepare(
        `INSERT INTO video_teardown_parts (video_id, part, engine, json, problem, made_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (video_id, part) DO UPDATE SET
           engine = excluded.engine, json = excluded.json, problem = excluded.problem, made_at = excluded.made_at`,
      )
      .run(
        videoId,
        part,
        made ? entry.engine.trim() : null,
        made ? entry.json : null,
        made ? null : entry.problem.slice(0, MAX_PROBLEM_CHARS),
        at.toISOString(),
      );
  }

  remove(videoId: string): void {
    this.db.prepare('DELETE FROM video_teardown_parts WHERE video_id = ?').run(videoId);
  }

  videos(): readonly { readonly videoId: string; readonly updatedAt: Date }[] {
    return this.db
      .prepare<[number], { video_id: string; updated: string }>(
        `SELECT video_id, MAX(made_at) AS updated FROM video_teardown_parts
         GROUP BY video_id ORDER BY updated DESC LIMIT ?`,
      )
      .all(LIST_LIMIT)
      .map((row) => ({ videoId: row.video_id, updatedAt: new Date(row.updated) }));
  }
}

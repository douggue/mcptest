import { BREAKDOWN_PARTS, isBreakdownPart, type BreakdownPartId } from '../breakdown/parts';
import type { Db } from '../db/sqlite';
import { CHANNEL_ID_PATTERN } from '../sources/parse';
import type {
  BreakdownCaveat,
  BreakdownRepo,
  FailedBreakdownPart,
  StoredBreakdownPart,
  WrittenBreakdownPart,
} from './types';

/**
 * The parts of a channel's breakdown, one row per channel and part: the text
 * an engine wrote, or the reason the part could not be written. Seven runs
 * of an engine go into a breakdown, so it is kept and opens again without
 * being run again; a new run replaces a row.
 *
 * A part is a model's words about a channel anyone could have made. It is
 * stored and handed out as it is, and it is for whoever reads it to treat it
 * as a study, never as instructions.
 */

/**
 * The most characters kept for one part. The longest part asked for is under
 * two thousand words; anything far beyond this is not a part.
 */
export const MAX_PART_CHARS = 60_000;
const MAX_ENGINE_NAME_LENGTH = 40;
const MAX_REASON_CHARS = 500;

interface PartRow {
  channel_id: string;
  part: string;
  engine: string | null;
  notes: string | null;
  problem: string | null;
  caveat_json: string | null;
  written_at: string;
}

const COLUMNS = 'channel_id, part, engine, notes, problem, caveat_json, written_at';

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;

/** A caveat as kept: only the two things it may say, each checked; anything else is dropped. */
function caveatOf(json: string | null): BreakdownCaveat | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { standInFor, unseen } = parsed as Record<string, unknown>;
  const stand = typeof standInFor === 'object' && standInFor !== null ? standInFor : null;
  const engine = stand
    ? text((stand as Record<string, unknown>)['engine'], MAX_ENGINE_NAME_LENGTH)
    : null;
  const because = stand
    ? text((stand as Record<string, unknown>)['because'], MAX_REASON_CHARS)
    : null;
  const shown =
    typeof unseen === 'object' && unseen !== null
      ? (unseen as Record<string, unknown>)['shown']
      : null;
  const caveat: BreakdownCaveat = {
    ...(engine !== null && because !== null ? { standInFor: { engine, because } } : {}),
    ...(typeof shown === 'number' && Number.isInteger(shown) && shown > 0
      ? { unseen: { shown } }
      : {}),
  };
  return Object.keys(caveat).length === 0 ? null : caveat;
}

/** A caveat as stored: null when it says nothing. */
const caveatJson = (caveat: BreakdownCaveat | undefined): string | null => {
  const kept = caveat === undefined ? null : caveatOf(JSON.stringify(caveat));
  return kept === null ? null : JSON.stringify(kept);
};

/** A row as a stored part; null for one something else wrote badly, which is no part at all. */
function partOf(row: PartRow): StoredBreakdownPart | null {
  const writtenAt = new Date(row.written_at);
  if (Number.isNaN(writtenAt.getTime()) || !isBreakdownPart(row.part)) return null;
  const head = { channelId: row.channel_id, part: row.part, writtenAt };
  if (row.notes !== null && row.notes.trim() !== '' && row.engine !== null) {
    const caveat = caveatOf(row.caveat_json);
    return {
      ...head,
      written: true,
      engine: row.engine,
      text: row.notes,
      ...(caveat === null ? {} : { caveat }),
    };
  }
  if (row.problem !== null && row.problem.trim() !== '') {
    return { ...head, written: false, reason: row.problem };
  }
  return null;
}

function checkPlace(channelId: string, part: BreakdownPartId): void {
  if (!CHANNEL_ID_PATTERN.test(channelId)) {
    throw new Error(`Not a valid YouTube channel id: "${channelId.slice(0, 40)}"`);
  }
  if (!isBreakdownPart(part)) throw new Error('Not a part of a breakdown');
}

export class SqliteBreakdownRepo implements BreakdownRepo {
  constructor(private readonly db: Db) {}

  list(channelId: string): readonly StoredBreakdownPart[] {
    const rows = this.db
      .prepare<[string], PartRow>(`SELECT ${COLUMNS} FROM breakdown_parts WHERE channel_id = ?`)
      .all(channelId);
    const parts = rows.flatMap((row) => partOf(row) ?? []);
    return BREAKDOWN_PARTS.flatMap((id) => parts.filter((part) => part.part === id));
  }

  find(channelId: string, part: BreakdownPartId): StoredBreakdownPart | null {
    const row = this.db
      .prepare<[string, string], PartRow>(
        `SELECT ${COLUMNS} FROM breakdown_parts WHERE channel_id = ? AND part = ?`,
      )
      .get(channelId, part);
    return row ? partOf(row) : null;
  }

  saveWritten(part: WrittenBreakdownPart, writtenAt: Date): void {
    checkPlace(part.channelId, part.part);
    const engine = part.engine.trim();
    if (engine === '' || engine.length > MAX_ENGINE_NAME_LENGTH) {
      throw new Error('A part needs the name of the engine that wrote it');
    }
    if (part.text.trim() === '') throw new Error('A part cannot be empty');
    this.put(
      part,
      {
        engine,
        notes: part.text.slice(0, MAX_PART_CHARS),
        problem: null,
        caveat_json: caveatJson(part.caveat),
      },
      writtenAt,
    );
  }

  saveFailed(part: FailedBreakdownPart, failedAt: Date): void {
    checkPlace(part.channelId, part.part);
    const problem = part.reason.trim().slice(0, MAX_REASON_CHARS);
    if (problem === '') throw new Error('A part that failed needs the reason');
    this.put(part, { engine: null, notes: null, problem, caveat_json: null }, failedAt);
  }

  private put(
    place: { readonly channelId: string; readonly part: BreakdownPartId },
    held: Pick<PartRow, 'engine' | 'notes' | 'problem' | 'caveat_json'>,
    at: Date,
  ): void {
    this.db
      .prepare(
        `INSERT INTO breakdown_parts (${COLUMNS})
         VALUES (@channelId, @part, @engine, @notes, @problem, @caveat_json, @writtenAt)
         ON CONFLICT (channel_id, part) DO UPDATE SET
           engine = excluded.engine,
           notes = excluded.notes,
           problem = excluded.problem,
           caveat_json = excluded.caveat_json,
           written_at = excluded.written_at`,
      )
      .run({ channelId: place.channelId, part: place.part, ...held, writtenAt: at.toISOString() });
  }
}

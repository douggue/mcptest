import { z } from 'zod';
import type { Db } from '../db/sqlite';
import {
  MAX_FORMAT_NAME,
  MAX_SLOT_NOTE,
  changeProblem,
  type Format,
  type FormatChange,
  type FormatSlots,
  type MixSuggestion,
} from '../format/formats';
import { CHANNEL_ID_PATTERN } from '../sources/parse';
import { INGREDIENT_LAYERS } from '../format/types';

/**
 * The formats the owner builds, and the one each channel uses. Slots and the
 * last suggestion are kept as JSON and checked with a schema when read: slots
 * that no longer read are empty, a suggestion that no longer reads is none.
 */

const LAYER = z.enum(INGREDIENT_LAYERS);
const slotsSchema = z.partialRecord(
  LAYER,
  z.object({ ingredientId: z.number().int().positive(), note: z.string().max(MAX_SLOT_NOTE) }),
);
const suggestionSchema = z.object({
  slots: z
    .array(
      z.object({
        layer: LAYER,
        ingredientId: z.number().int().positive(),
        reason: z.string().max(400),
      }),
    )
    .max(INGREDIENT_LAYERS.length),
  summary: z.string().max(2_000),
  dropped: z.array(z.string().max(400)).max(40),
  engine: z.string().min(1).max(40),
  writtenAt: z.string().min(1).max(40),
});

interface Row {
  id: number;
  name: string;
  target_seconds: number | null;
  notes: string;
  slots_json: string;
  suggestion_json: string | null;
  copied_from: number | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, name, target_seconds, notes, slots_json, suggestion_json, copied_from, created_at, updated_at';

function readJson<T>(schema: z.ZodType<T>, json: string | null, fallback: T): T {
  if (json === null) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

const formatOf = (row: Row): Format => ({
  id: row.id,
  name: row.name,
  targetSeconds: row.target_seconds,
  notes: row.notes,
  slots: readJson<FormatSlots>(slotsSchema, row.slots_json, {}),
  suggestion: readJson<MixSuggestion | null>(suggestionSchema, row.suggestion_json, null),
  copiedFrom: row.copied_from,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** "Long-form" becomes "Long-form v2"; "Long-form v2" becomes "Long-form v3". */
export function nextVersionName(name: string): string {
  const match = /^(.*) v(\d+)$/.exec(name);
  const next = match ? `${match[1]} v${Number(match[2]) + 1}` : `${name} v2`;
  return next.length > MAX_FORMAT_NAME ? next.slice(next.length - MAX_FORMAT_NAME) : next;
}

export class SqliteFormatRepo {
  constructor(private readonly db: Db) {}

  /** Every format, the one changed last first. */
  list(): readonly Format[] {
    return this.db
      .prepare<[], Row>(`SELECT ${COLUMNS} FROM formats ORDER BY updated_at DESC, id DESC`)
      .all()
      .map(formatOf);
  }

  find(id: number): Format | null {
    const row = this.db
      .prepare<[number], Row>(`SELECT ${COLUMNS} FROM formats WHERE id = ?`)
      .get(id);
    return row ? formatOf(row) : null;
  }

  /** Throws when the name or length breaks a rule. */
  create(name: string, targetSeconds: number | null, now: Date): Format {
    const problem = changeProblem({ name, targetSeconds });
    if (problem !== null) throw new Error(problem);
    const at = now.toISOString();
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO formats (name, target_seconds, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      )
      .run(name.trim(), targetSeconds, at, at);
    return this.find(Number(lastInsertRowid)) as Format;
  }

  /** The format as changed; null when there is none. Throws when a change breaks a rule. */
  update(id: number, change: FormatChange, now: Date): Format | null {
    const problem = changeProblem(change);
    if (problem !== null) throw new Error(problem);
    const current = this.find(id);
    if (current === null) return null;
    const slots = change.slots === undefined ? current.slots : slotsSchema.parse(change.slots);
    this.db
      .prepare(
        `UPDATE formats SET name = ?, target_seconds = ?, notes = ?, slots_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        change.name?.trim() ?? current.name,
        change.targetSeconds === undefined ? current.targetSeconds : change.targetSeconds,
        change.notes ?? current.notes,
        JSON.stringify(slots),
        now.toISOString(),
        id,
      );
    return this.find(id);
  }

  /** A copy to make the next version from, named "… v2"; null when there is no such format. */
  duplicate(id: number, now: Date): Format | null {
    const current = this.find(id);
    if (current === null) return null;
    const at = now.toISOString();
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO formats (name, target_seconds, notes, slots_json, copied_from, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nextVersionName(current.name),
        current.targetSeconds,
        current.notes,
        JSON.stringify(current.slots),
        id,
        at,
        at,
      );
    return this.find(Number(lastInsertRowid));
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM formats WHERE id = ?').run(id).changes > 0;
  }

  /** Keeps the last suggested mix of a format; false when there is no such format. */
  saveSuggestion(id: number, suggestion: MixSuggestion): boolean {
    const json = JSON.stringify(suggestionSchema.parse(suggestion));
    return (
      this.db.prepare('UPDATE formats SET suggestion_json = ? WHERE id = ?').run(json, id).changes >
      0
    );
  }

  /** The format a channel uses; null when it has none. */
  activeFor(channelId: string): Format | null {
    const row = this.db
      .prepare<[string], { format_id: number }>(
        'SELECT format_id FROM channel_formats WHERE channel_id = ?',
      )
      .get(channelId);
    return row ? this.find(row.format_id) : null;
  }

  /** Makes a format the channel's own, or (null) none; false when there is no such format. */
  setActive(channelId: string, formatId: number | null, now: Date): boolean {
    if (!CHANNEL_ID_PATTERN.test(channelId)) throw new Error('Not a channel id');
    if (formatId === null) {
      this.db.prepare('DELETE FROM channel_formats WHERE channel_id = ?').run(channelId);
      return true;
    }
    if (this.find(formatId) === null) return false;
    this.db
      .prepare(
        `INSERT INTO channel_formats (channel_id, format_id, set_at) VALUES (?, ?, ?)
         ON CONFLICT (channel_id) DO UPDATE SET format_id = excluded.format_id, set_at = excluded.set_at`,
      )
      .run(channelId, formatId, now.toISOString());
    return true;
  }
}

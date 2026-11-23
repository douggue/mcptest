import { z } from 'zod';
import type { Db } from '../db/sqlite';
import { MAX_INGREDIENT_NOTE, draftProblem, isProven } from '../format/evidence';
import {
  INGREDIENT_LAYERS,
  INGREDIENT_SOURCES,
  type Ingredient,
  type IngredientDraft,
  type IngredientRepo,
} from '../format/types';

/**
 * The format builder's shelf. One row per piece taken from a source; adding
 * the same piece to the same layer again answers the row already there. The
 * JSON columns are checked with a schema again when read, and a row that no
 * longer reads is left off the list rather than shown half.
 */

/** The most characters of an ingredient's details kept as JSON. */
export const MAX_DETAILS_CHARS = 40_000;
const MAX_MEDIA = 24;

const evidenceSchema = z.object({
  score: z.number().finite().nonnegative().nullable(),
  scoredVideos: z.number().int().nonnegative(),
  videos: z.number().int().nonnegative().nullable(),
  channels: z.number().int().nonnegative().nullable(),
  measured: z
    .array(
      z.object({
        label: z.string().max(200),
        value: z.number().finite(),
        unit: z.string().max(80),
        method: z.string().max(1500),
      }),
    )
    .max(40),
});

const VIDEO = z.string().regex(/^[\w-]{11}$/);
const mediaSchema = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('thumbnail'), videoId: VIDEO }),
      z.object({
        kind: z.enum(['keyframe', 'strip']),
        videoId: VIDEO,
        file: z.string().regex(/^[\w.-]{1,40}$/),
      }),
      z.object({ kind: z.literal('quote'), text: z.string().max(600), videoId: VIDEO.nullable() }),
      z.object({
        kind: z.literal('image'),
        file: z.string().regex(/^[\w-]{11}\.(?:png|jpg|webp)$/),
      }),
    ]),
  )
  .max(MAX_MEDIA);

const rowSchema = z.object({
  layer: z.enum(INGREDIENT_LAYERS),
  source: z.enum(INGREDIENT_SOURCES),
  channelIds: z.array(z.string()).max(200),
  details: z.record(z.string(), z.unknown()),
  evidence: evidenceSchema,
  media: mediaSchema,
});

interface Row {
  id: number;
  layer: string;
  name: string;
  source_kind: string;
  source_key: string;
  source_label: string;
  center_channel_id: string | null;
  channel_ids_json: string;
  details_json: string;
  evidence_json: string;
  media_json: string;
  note: string;
  added_at: string;
}

const COLUMNS = `id, layer, name, source_kind, source_key, source_label, center_channel_id,
  channel_ids_json, details_json, evidence_json, media_json, note, added_at`;

function readRow(row: Row): Ingredient | null {
  try {
    const parsed = rowSchema.safeParse({
      layer: row.layer,
      source: row.source_kind,
      channelIds: JSON.parse(row.channel_ids_json),
      details: JSON.parse(row.details_json),
      evidence: JSON.parse(row.evidence_json),
      media: JSON.parse(row.media_json),
    });
    if (!parsed.success) return null;
    return {
      ...parsed.data,
      id: row.id,
      name: row.name,
      sourceKey: row.source_key,
      sourceLabel: row.source_label,
      centerChannelId: row.center_channel_id,
      note: row.note,
      addedAt: row.added_at,
      proven: isProven(parsed.data.evidence),
    };
  } catch {
    return null;
  }
}

export class SqliteIngredientRepo implements IngredientRepo {
  constructor(private readonly db: Db) {}

  list(): readonly Ingredient[] {
    return this.db
      .prepare<[], Row>(`SELECT ${COLUMNS} FROM format_ingredients ORDER BY added_at DESC, id DESC`)
      .all()
      .flatMap((row) => readRow(row) ?? []);
  }

  find(id: number): Ingredient | null {
    const row = this.db
      .prepare<[number], Row>(`SELECT ${COLUMNS} FROM format_ingredients WHERE id = ?`)
      .get(id);
    return row ? readRow(row) : null;
  }

  add(draft: IngredientDraft, addedAt: Date): Ingredient {
    const problem = draftProblem(draft) ?? this.shapeProblem(draft);
    if (problem !== null) throw new Error(problem);
    const details = JSON.stringify(draft.details);
    if (details.length > MAX_DETAILS_CHARS) throw new Error('Its details are too long to keep.');
    this.db
      .prepare(
        `INSERT INTO format_ingredients (layer, name, source_kind, source_key, source_label,
           center_channel_id, channel_ids_json, details_json, evidence_json, media_json, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (layer, source_kind, source_key) DO NOTHING`,
      )
      .run(
        draft.layer,
        draft.name.trim(),
        draft.source,
        draft.sourceKey,
        draft.sourceLabel.slice(0, 200),
        draft.centerChannelId,
        JSON.stringify([...new Set(draft.channelIds)]),
        details,
        JSON.stringify(draft.evidence),
        JSON.stringify(draft.media),
        addedAt.toISOString(),
      );
    const row = this.db
      .prepare<[string, string, string], { id: number }>(
        'SELECT id FROM format_ingredients WHERE layer = ? AND source_kind = ? AND source_key = ?',
      )
      .get(draft.layer, draft.source, draft.sourceKey);
    const stored = row ? this.find(row.id) : null;
    if (stored === null) throw new Error('The ingredient could not be read back.');
    return stored;
  }

  setNote(id: number, note: string): boolean {
    const result = this.db
      .prepare('UPDATE format_ingredients SET note = ? WHERE id = ?')
      .run(note.trim().slice(0, MAX_INGREDIENT_NOTE), id);
    return result.changes > 0;
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM format_ingredients WHERE id = ?').run(id).changes > 0;
  }

  private shapeProblem(draft: IngredientDraft): string | null {
    const parsed = rowSchema.safeParse({ ...draft, channelIds: [...draft.channelIds] });
    return parsed.success ? null : 'Its evidence or pictures are not in a form that can be kept.';
  }
}

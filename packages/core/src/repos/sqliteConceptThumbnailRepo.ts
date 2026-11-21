import { z } from 'zod';
import type { Db } from '../db/sqlite';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import type { ConceptThumbnailRepo, NewConceptThumbnail, StoredConceptThumbnail } from './types';

/**
 * The thumbnail prompt written for one concept: the prompt, why that style,
 * and the videos whose thumbnails it was learned from. It belongs to its
 * concept and goes with it, and so to one centre channel; a new run replaces it.
 */

const MAX_ENGINE_NAME_LENGTH = 40;
/** The thumbnails one prompt is shown beside: more is a wall of pictures. */
export const MAX_LEARNED_FROM = 12;

interface ThumbnailRow {
  concept_id: number;
  prompt: string;
  why: string;
  video_ids_json: string;
  engine: string;
  written_at: string;
}

const idsSchema = z.array(z.string().regex(VIDEO_ID_PATTERN));

/** The stored ids read back through a schema; none when they are not what was written. */
function idsOf(json: string): readonly string[] {
  try {
    const parsed = idsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export class SqliteConceptThumbnailRepo implements ConceptThumbnailRepo {
  constructor(private readonly db: Db) {}

  find(centerChannelId: string, conceptId: number): StoredConceptThumbnail | null {
    const row = this.db
      .prepare<[number, string], ThumbnailRow>(
        `SELECT t.concept_id, t.prompt, t.why, t.video_ids_json, t.engine, t.written_at
         FROM concept_thumbnails t
         JOIN concepts c ON c.id = t.concept_id
         JOIN concept_batches b ON b.id = c.batch_id
         WHERE t.concept_id = ? AND b.center_channel_id = ?`,
      )
      .get(conceptId, centerChannelId);
    if (!row) return null;
    return {
      conceptId: row.concept_id,
      prompt: row.prompt,
      why: row.why,
      learnedFrom: idsOf(row.video_ids_json),
      engine: row.engine,
      writtenAt: new Date(row.written_at),
    };
  }

  save(conceptId: number, thumbnail: NewConceptThumbnail, writtenAt: Date): void {
    const engine = thumbnail.engine.trim();
    if (engine === '' || engine.length > MAX_ENGINE_NAME_LENGTH) {
      throw new Error('A thumbnail prompt needs the name of the engine that wrote it');
    }
    if (thumbnail.prompt.trim() === '') throw new Error('A thumbnail prompt cannot be empty');
    const ids = idsSchema.parse(thumbnail.learnedFrom.slice(0, MAX_LEARNED_FROM));
    this.db
      .prepare(
        `INSERT INTO concept_thumbnails (concept_id, prompt, why, video_ids_json, engine, written_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (concept_id) DO UPDATE SET
           prompt = excluded.prompt, why = excluded.why, video_ids_json = excluded.video_ids_json,
           engine = excluded.engine, written_at = excluded.written_at`,
      )
      .run(
        conceptId,
        thumbnail.prompt,
        thumbnail.why,
        JSON.stringify(ids),
        engine,
        writtenAt.toISOString(),
      );
  }
}

import type {
  AddOptions,
  ConceptFields,
  ConceptFormat,
  ConceptLength,
  ConceptOrigin,
  ConceptRepo,
  NewBatch,
  NewConcept,
  StoredBatch,
  StoredConcept,
} from '../concepts/types';
import { CONCEPT_LENGTHS } from '../concepts/types';
import type { Db } from '../db/sqlite';
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from '../sources/parse';

/**
 * Concepts and the batches they came from. Every read and every change goes
 * through the centre channel the batch was made for, so a concept written for
 * one channel can never be listed, kept or handed to an engine for another.
 *
 * A concept is a model's words. It is stored as written and is for whoever
 * reads it to treat as a description, never as instructions.
 */

const ORIGINS: readonly ConceptOrigin[] = ['batch', 'twist', 'more'];
const FORMAT_SOURCES: readonly ConceptFormat['source'][] = ['transfer', 'formula'];
const MAX_ENGINE_NAME_LENGTH = 40;
/** The fields of a concept that must hold something, with the name each is refused by. */
const REQUIRED: readonly (readonly [keyof ConceptFields, string])[] = [
  ['title', 'title'],
  ['thumbnail', 'thumbnail brief'],
  ['overlay', 'overlay text'],
  ['hook', 'hook'],
  ['restsOn', 'rests-on line'],
  ['needs', 'needs line'],
];

interface BatchRow {
  id: number;
  center_channel_id: string;
  inspiration_json: string;
  hook_models_json: string;
  format_source: string | null;
  format_ref: string | null;
  format_template: string | null;
  angle: string | null;
  length: string;
  created_at: string;
}

interface ConceptRow {
  id: number;
  batch_id: number;
  center_channel_id: string;
  title: string;
  alt_title_1: string;
  alt_title_2: string;
  thumbnail: string;
  overlay: string;
  hook: string;
  hook_style: string | null;
  rests_on: string;
  needs: string;
  origin: string;
  parent_id: number | null;
  engine: string;
  kept: number;
  created_at: string;
}

const CONCEPT_COLUMNS = `c.id, c.batch_id, b.center_channel_id, c.title, c.alt_title_1, c.alt_title_2,
  c.thumbnail, c.overlay, c.hook, c.hook_style, c.rests_on, c.needs, c.origin, c.parent_id, c.engine, c.kept,
  c.created_at`;

/** The stored video ids of a batch; anything that is not a list of ids is no list at all. */
function videoIdsOf(json: string): readonly string[] {
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.filter((id): id is string => typeof id === 'string' && VIDEO_ID_PATTERN.test(id));
  } catch {
    return [];
  }
}

function formatOf(row: BatchRow): ConceptFormat | null {
  const source = FORMAT_SOURCES.find((known) => known === row.format_source);
  if (!source || row.format_ref === null || row.format_template === null) return null;
  return { source, ref: row.format_ref, template: row.format_template };
}

function toBatch(row: BatchRow): StoredBatch {
  const length = CONCEPT_LENGTHS.find((known) => known === row.length) ?? 'long';
  return {
    id: row.id,
    centerChannelId: row.center_channel_id,
    inspiration: videoIdsOf(row.inspiration_json),
    hookModels: videoIdsOf(row.hook_models_json),
    format: formatOf(row),
    angle: row.angle,
    length: length satisfies ConceptLength,
    createdAt: new Date(row.created_at),
  };
}

function toConcept(row: ConceptRow): StoredConcept {
  return {
    id: row.id,
    batchId: row.batch_id,
    centerChannelId: row.center_channel_id,
    title: row.title,
    altTitles: [row.alt_title_1, row.alt_title_2],
    thumbnail: row.thumbnail,
    overlay: row.overlay,
    hook: row.hook,
    hookStyle: row.hook_style,
    restsOn: row.rests_on,
    needs: row.needs,
    origin: ORIGINS.find((known) => known === row.origin) ?? 'batch',
    parentId: row.parent_id,
    engine: row.engine,
    kept: row.kept === 1,
    createdAt: new Date(row.created_at),
  };
}

/** Throws, naming the field, when a concept could not be shown or used as it is. */
function checkConcept(concept: NewConcept): void {
  const empty = REQUIRED.find(([field]) => String(concept[field]).trim() === '');
  if (empty) throw new Error(`A concept needs its ${empty[1]}`);
  if (concept.altTitles.some((title) => title.trim() === '')) {
    throw new Error('A concept needs both of its alternate titles');
  }
  if (!ORIGINS.includes(concept.origin)) throw new Error('Not a kind of concept');
  const engine = concept.engine.trim();
  if (engine === '' || engine.length > MAX_ENGINE_NAME_LENGTH) {
    throw new Error('A concept needs the name of the engine that wrote it');
  }
}

function checkBatch(batch: NewBatch): void {
  if (!CHANNEL_ID_PATTERN.test(batch.centerChannelId)) {
    throw new Error('A batch of concepts is made for a channel id');
  }
  if ([...batch.inspiration, ...batch.hookModels].some((id) => !VIDEO_ID_PATTERN.test(id))) {
    throw new Error('A batch of concepts rests on videos named by their video id');
  }
  if (!CONCEPT_LENGTHS.includes(batch.length)) throw new Error('Not a length for concepts');
}

export class SqliteConceptRepo implements ConceptRepo {
  constructor(private readonly db: Db) {}

  createBatch(batch: NewBatch, createdAt: Date): number {
    checkBatch(batch);
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO concept_batches
           (center_channel_id, inspiration_json, hook_models_json, format_source, format_ref,
            format_template, angle, length, created_at)
         VALUES (@center, @inspiration, @hookModels, @source, @ref, @template, @angle, @length,
                 @createdAt)`,
      )
      .run({
        center: batch.centerChannelId,
        inspiration: JSON.stringify(batch.inspiration),
        hookModels: JSON.stringify(batch.hookModels),
        source: batch.format?.source ?? null,
        ref: batch.format?.ref ?? null,
        template: batch.format?.template ?? null,
        angle: batch.angle,
        length: batch.length,
        createdAt: createdAt.toISOString(),
      });
    return Number(lastInsertRowid);
  }

  findBatch(centerChannelId: string, batchId: number): StoredBatch | null {
    const row = this.db
      .prepare<[number, string], BatchRow>(
        'SELECT * FROM concept_batches WHERE id = ? AND center_channel_id = ?',
      )
      .get(batchId, centerChannelId);
    return row ? toBatch(row) : null;
  }

  listBatches(centerChannelId: string): readonly StoredBatch[] {
    return this.db
      .prepare<[string], BatchRow>(
        'SELECT * FROM concept_batches WHERE center_channel_id = ? ORDER BY id DESC',
      )
      .all(centerChannelId)
      .map(toBatch);
  }

  addConcepts(
    batchId: number,
    concepts: readonly NewConcept[],
    createdAt: Date,
    options: AddOptions = {},
  ): readonly StoredConcept[] {
    concepts.forEach(checkConcept);
    const insert = this.db.prepare(
      `INSERT INTO concepts
         (batch_id, title, alt_title_1, alt_title_2, thumbnail, overlay, hook, hook_style,
          rests_on, needs, origin, parent_id, engine, kept, created_at)
       VALUES (@batchId, @title, @alt1, @alt2, @thumbnail, @overlay, @hook, @hookStyle,
               @restsOn, @needs, @origin, @parentId, @engine, 0, @createdAt)`,
    );
    const store = this.db.transaction((): readonly number[] => {
      const batch = this.db
        .prepare<[number], BatchRow>('SELECT * FROM concept_batches WHERE id = ?')
        .get(batchId);
      if (!batch) throw new Error('There is no such batch of concepts');
      if (options.replaceUnkept) this.removeUnkept(batch.center_channel_id, batchId);
      return concepts.map((concept) =>
        Number(
          insert.run({
            batchId,
            title: concept.title,
            alt1: concept.altTitles[0],
            alt2: concept.altTitles[1],
            thumbnail: concept.thumbnail,
            overlay: concept.overlay,
            hook: concept.hook,
            hookStyle: concept.hookStyle,
            restsOn: concept.restsOn,
            needs: concept.needs,
            origin: concept.origin,
            parentId: concept.parentId,
            engine: concept.engine.trim(),
            createdAt: createdAt.toISOString(),
          }).lastInsertRowid,
        ),
      );
    });
    const ids = new Set(store());
    return this.listOf(batchId).filter((concept) => ids.has(concept.id));
  }

  find(centerChannelId: string, conceptId: number): StoredConcept | null {
    const row = this.db
      .prepare<[number, string], ConceptRow>(
        `SELECT ${CONCEPT_COLUMNS} FROM concepts c JOIN concept_batches b ON b.id = c.batch_id
         WHERE c.id = ? AND b.center_channel_id = ?`,
      )
      .get(conceptId, centerChannelId);
    return row ? toConcept(row) : null;
  }

  listForCenter(centerChannelId: string): readonly StoredConcept[] {
    return this.db
      .prepare<[string], ConceptRow>(
        `SELECT ${CONCEPT_COLUMNS} FROM concepts c JOIN concept_batches b ON b.id = c.batch_id
         WHERE b.center_channel_id = ? ORDER BY c.kept DESC, c.batch_id DESC, c.id`,
      )
      .all(centerChannelId)
      .map(toConcept);
  }

  setKept(centerChannelId: string, conceptId: number, kept: boolean): boolean {
    const { changes } = this.db
      .prepare(
        `UPDATE concepts SET kept = ? WHERE id = ? AND batch_id IN
           (SELECT id FROM concept_batches WHERE center_channel_id = ?)`,
      )
      .run(kept ? 1 : 0, conceptId, centerChannelId);
    return changes > 0;
  }

  clearUnkept(centerChannelId: string): number {
    return this.db.transaction(() => this.removeUnkept(centerChannelId, null))();
  }

  removeBatchIfEmpty(batchId: number): void {
    this.db
      .prepare(
        `DELETE FROM concept_batches WHERE id = ?
           AND NOT EXISTS (SELECT 1 FROM concepts WHERE batch_id = concept_batches.id)`,
      )
      .run(batchId);
  }

  /** One batch's concepts in the order they were written. */
  private listOf(batchId: number): readonly StoredConcept[] {
    return this.db
      .prepare<[number], ConceptRow>(
        `SELECT ${CONCEPT_COLUMNS} FROM concepts c JOIN concept_batches b ON b.id = c.batch_id
         WHERE c.batch_id = ? ORDER BY c.id`,
      )
      .all(batchId)
      .map(toConcept);
  }

  /**
   * Removes a channel's concepts that were not kept, sparing one batch when
   * named, then the channel's batches left with nothing. Returns how many
   * concepts went. Runs inside the caller's transaction.
   */
  private removeUnkept(centerChannelId: string, spareBatchId: number | null): number {
    const { changes } = this.db
      .prepare(
        `DELETE FROM concepts WHERE kept = 0 AND batch_id IS NOT @spare AND batch_id IN
           (SELECT id FROM concept_batches WHERE center_channel_id = @center)`,
      )
      .run({ center: centerChannelId, spare: spareBatchId });
    this.db
      .prepare(
        `DELETE FROM concept_batches WHERE center_channel_id = @center AND id IS NOT @spare
           AND NOT EXISTS (SELECT 1 FROM concepts WHERE batch_id = concept_batches.id)`,
      )
      .run({ center: centerChannelId, spare: spareBatchId });
    return changes;
  }
}

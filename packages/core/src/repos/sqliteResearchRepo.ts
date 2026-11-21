import { z } from 'zod';
import type { Db } from '../db/sqlite';
import type { Fact, FactSheet } from '../research/factSheet';
import type {
  CheckedClaim,
  ResearchRepo,
  StoredClaim,
  StoredFactSheet,
  TypedLength,
} from '../research/types';

/**
 * The script writer's research for one concept: its fact sheet, the claims
 * check of its script, and the length the owner typed. Each belongs to its
 * concept and goes with it; each is read through the centre channel the
 * concept belongs to, so another channel's research is never handed out.
 */

const MAX_ENGINE_NAME_LENGTH = 40;
/** The concept, when it is one of this centre channel's. */
const OWNED = `JOIN concepts c ON c.id = r.concept_id
  JOIN concept_batches b ON b.id = c.batch_id
  WHERE r.concept_id = ? AND b.center_channel_id = ?`;

const factsSchema = z.array(
  z.object({ number: z.number().int(), text: z.string(), sources: z.array(z.string()) }),
);
const linesSchema = z.array(z.string());

/** Stored JSON read back through a schema; the fallback when it is not what was written. */
function read<T>(schema: z.ZodType<T>, json: string, fallback: T): T {
  try {
    const parsed = schema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function engineName(engine: string): string {
  const name = engine.trim();
  if (name === '' || name.length > MAX_ENGINE_NAME_LENGTH) {
    throw new Error('Research needs the name of the engine that did it');
  }
  return name;
}

interface SheetRow {
  concept_id: number;
  facts_json: string;
  not_found_json: string;
  disputed_json: string;
  engine: string;
  written_at: string;
}

interface ClaimRow {
  what: string;
  sentence: string;
  verdict: 'confirmed' | 'wrong' | 'unsure';
  why: string;
  correction: string | null;
  sources_json: string;
  engine: string;
  checked_at: string;
}

const toClaim = (row: ClaimRow): StoredClaim => ({
  what: row.what,
  sentence: row.sentence,
  verdict: row.verdict,
  why: row.why,
  correction: row.correction,
  sources: read(linesSchema, row.sources_json, []),
  engine: row.engine,
  checkedAt: new Date(row.checked_at),
});

export class SqliteResearchRepo implements ResearchRepo {
  constructor(private readonly db: Db) {}

  findSheet(centerChannelId: string, conceptId: number): StoredFactSheet | null {
    const row = this.db
      .prepare<[number, string], SheetRow>(
        `SELECT r.concept_id, r.facts_json, r.not_found_json, r.disputed_json, r.engine, r.written_at
         FROM concept_research r ${OWNED}`,
      )
      .get(conceptId, centerChannelId);
    if (!row) return null;
    return {
      conceptId: row.concept_id,
      facts: read<readonly Fact[]>(factsSchema, row.facts_json, []),
      notFound: read(linesSchema, row.not_found_json, []),
      disputed: read(linesSchema, row.disputed_json, []),
      engine: row.engine,
      writtenAt: new Date(row.written_at),
    };
  }

  saveSheet(conceptId: number, sheet: FactSheet, engine: string, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO concept_research (concept_id, facts_json, not_found_json, disputed_json, engine, written_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (concept_id) DO UPDATE SET
           facts_json = excluded.facts_json, not_found_json = excluded.not_found_json,
           disputed_json = excluded.disputed_json, engine = excluded.engine,
           written_at = excluded.written_at`,
      )
      .run(
        conceptId,
        JSON.stringify(sheet.facts),
        JSON.stringify(sheet.notFound),
        JSON.stringify(sheet.disputed),
        engineName(engine),
        at.toISOString(),
      );
  }

  listClaims(centerChannelId: string, conceptId: number): readonly StoredClaim[] {
    return this.db
      .prepare<[number, string], ClaimRow>(
        `SELECT r.what, r.sentence, r.verdict, r.why, r.correction, r.sources_json, r.engine,
                r.checked_at
         FROM script_claims r ${OWNED} ORDER BY r.rowid`,
      )
      .all(conceptId, centerChannelId)
      .map(toClaim);
  }

  saveClaims(conceptId: number, claims: readonly CheckedClaim[], engine: string, at: Date): void {
    const name = engineName(engine);
    const statement = this.db.prepare(
      `INSERT INTO script_claims (concept_id, what, sentence, verdict, why, correction, sources_json, engine, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (concept_id, what, sentence) DO UPDATE SET
         verdict = excluded.verdict, why = excluded.why, correction = excluded.correction,
         sources_json = excluded.sources_json, engine = excluded.engine,
         checked_at = excluded.checked_at`,
    );
    this.db.transaction(() => {
      for (const claim of claims) {
        statement.run(
          conceptId,
          claim.what,
          claim.sentence,
          claim.verdict,
          claim.why,
          claim.correction,
          JSON.stringify(claim.sources),
          name,
          at.toISOString(),
        );
      }
    })();
  }

  removeClaim(conceptId: number, what: string, sentence: string): void {
    this.db
      .prepare('DELETE FROM script_claims WHERE concept_id = ? AND what = ? AND sentence = ?')
      .run(conceptId, what, sentence);
  }

  findLength(centerChannelId: string, conceptId: number): TypedLength | null {
    const row = this.db
      .prepare<[number, string], { typed: 'minutes' | 'words'; words: number | null }>(
        `SELECT r.typed, r.words FROM script_lengths r ${OWNED}`,
      )
      .get(conceptId, centerChannelId);
    return row ? { typed: row.typed, words: row.words } : null;
  }

  saveLength(conceptId: number, length: TypedLength, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO script_lengths (concept_id, typed, words, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (concept_id) DO UPDATE SET
           typed = excluded.typed, words = excluded.words, updated_at = excluded.updated_at`,
      )
      .run(conceptId, length.typed, length.words, at.toISOString());
  }
}

import { z } from 'zod';
import { CLAIM_PLACES } from '../risk/claims';
import type { RiskRepo, StoredRiskCheck } from '../risk/store';
import type { Db } from '../db/sqlite';

interface CheckRow {
  claims_json: string;
  notes_json: string;
  engine: string;
  checked_at: string;
  script_updated_at: string;
}

/** Checked again when read, as every list kept as JSON is. */
const claimsSchema = z.array(
  z.object({
    where: z.enum(CLAIM_PLACES),
    says: z.string(),
    script: z.string().nullable(),
    why: z.string(),
  }),
);
const notesSchema = z.array(z.object({ id: z.string(), note: z.string() }));

/** Stored JSON as data; null when it cannot be read, so a damaged row reads as no check. */
function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export class SqliteRiskRepo implements RiskRepo {
  constructor(private readonly db: Db) {}

  find(centerChannelId: string, conceptId: number): StoredRiskCheck | null {
    const row = this.db
      .prepare<[number, string], CheckRow>(
        `SELECT claims_json, notes_json, engine, checked_at, script_updated_at FROM risk_checks
         WHERE concept_id = ? AND center_channel_id = ?`,
      )
      .get(conceptId, centerChannelId);
    if (!row) return null;
    const claims = claimsSchema.safeParse(jsonOf(row.claims_json));
    const notes = notesSchema.safeParse(jsonOf(row.notes_json));
    if (!claims.success || !notes.success) return null;
    return {
      claims: claims.data,
      notes: notes.data,
      engine: row.engine,
      checkedAt: new Date(row.checked_at),
      scriptUpdatedAt: new Date(row.script_updated_at),
    };
  }

  save(centerChannelId: string, conceptId: number, check: StoredRiskCheck): void {
    this.db
      .prepare(
        `INSERT INTO risk_checks (concept_id, center_channel_id, claims_json, notes_json, engine,
           checked_at, script_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (concept_id) DO UPDATE SET
           claims_json = excluded.claims_json, notes_json = excluded.notes_json,
           engine = excluded.engine, checked_at = excluded.checked_at,
           script_updated_at = excluded.script_updated_at`,
      )
      .run(
        conceptId,
        centerChannelId,
        JSON.stringify(check.claims),
        JSON.stringify(check.notes),
        check.engine,
        check.checkedAt.toISOString(),
        check.scriptUpdatedAt.toISOString(),
      );
  }
}

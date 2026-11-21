import type { Db } from '../db/sqlite';
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from '../sources/parse';

/**
 * Title formulas an engine saw across the breakout titles of one channel's
 * map, kept per centre channel and window of days. A run replaces what the
 * run before it left for that channel and window. Only what was verified is
 * stored: the wording, the reason, and the ids of the videos behind it. The
 * numbers shown beside a formula are worked out from the store when it is read.
 *
 * A formula and its reason are a model's words: stored as written, and for
 * whoever reads them to treat as a description, never as instructions.
 */

/** Which run a set of formulas belongs to. */
export interface FormulaScope {
  readonly centerChannelId: string;
  readonly windowDays: number;
  /** The engine that proposed them, by its id. */
  readonly engine: string;
}

export interface NewFormula {
  readonly formula: string;
  readonly why: string;
  readonly videoIds: readonly string[];
}

export interface StoredFormula extends NewFormula, FormulaScope {
  readonly id: number;
  readonly runAt: Date;
}

export interface FormulaRepo {
  /** Stores a run's formulas in place of the ones stored for the same channel and window. */
  replace(scope: FormulaScope, formulas: readonly NewFormula[], runAt: Date): void;
  /** In the order they were given; empty when no run has been stored. */
  list(centerChannelId: string, windowDays: number): readonly StoredFormula[];
  /** Null when the formula does not exist or belongs to another channel. */
  find(centerChannelId: string, formulaId: number): StoredFormula | null;
}

interface FormulaRow {
  id: number;
  center_channel_id: string;
  window_days: number;
  formula: string;
  why: string;
  video_ids_json: string;
  engine: string;
  run_at: string;
}

const MAX_WINDOW_DAYS = 366;

function videoIdsOf(json: string): readonly string[] {
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.filter((id): id is string => typeof id === 'string' && VIDEO_ID_PATTERN.test(id));
  } catch {
    return [];
  }
}

function toFormula(row: FormulaRow): StoredFormula {
  return {
    id: row.id,
    centerChannelId: row.center_channel_id,
    windowDays: row.window_days,
    formula: row.formula,
    why: row.why,
    videoIds: videoIdsOf(row.video_ids_json),
    engine: row.engine,
    runAt: new Date(row.run_at),
  };
}

function checkScope(scope: FormulaScope): void {
  if (!CHANNEL_ID_PATTERN.test(scope.centerChannelId)) {
    throw new Error('Formulas are kept for a channel id');
  }
  const { windowDays } = scope;
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > MAX_WINDOW_DAYS) {
    throw new Error('A window is a whole number of days');
  }
}

export class SqliteFormulaRepo implements FormulaRepo {
  constructor(private readonly db: Db) {}

  replace(scope: FormulaScope, formulas: readonly NewFormula[], runAt: Date): void {
    checkScope(scope);
    if (formulas.some((one) => one.videoIds.some((id) => !VIDEO_ID_PATTERN.test(id)))) {
      throw new Error('A formula rests on videos named by their video id');
    }
    const insert = this.db.prepare(
      `INSERT INTO title_formulas
         (center_channel_id, window_days, formula, why, video_ids_json, engine, run_at)
       VALUES (@center, @window, @formula, @why, @videoIds, @engine, @runAt)`,
    );
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM title_formulas WHERE center_channel_id = ? AND window_days = ?')
        .run(scope.centerChannelId, scope.windowDays);
      for (const one of formulas) {
        insert.run({
          center: scope.centerChannelId,
          window: scope.windowDays,
          formula: one.formula,
          why: one.why,
          videoIds: JSON.stringify(one.videoIds),
          engine: scope.engine,
          runAt: runAt.toISOString(),
        });
      }
    })();
  }

  list(centerChannelId: string, windowDays: number): readonly StoredFormula[] {
    return this.db
      .prepare<[string, number], FormulaRow>(
        `SELECT * FROM title_formulas WHERE center_channel_id = ? AND window_days = ? ORDER BY id`,
      )
      .all(centerChannelId, windowDays)
      .map(toFormula);
  }

  find(centerChannelId: string, formulaId: number): StoredFormula | null {
    const row = this.db
      .prepare<[number, string], FormulaRow>(
        'SELECT * FROM title_formulas WHERE id = ? AND center_channel_id = ?',
      )
      .get(formulaId, centerChannelId);
    return row ? toFormula(row) : null;
  }
}

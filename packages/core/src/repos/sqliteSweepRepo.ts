import type { FindVia } from '../bank/cost';
import type { Db } from '../db/sqlite';
import { READING_BUDGET_DEFAULT, type Pots } from '../sweep/budget';
import type {
  StoredSweep,
  SweepEnd,
  SweepFind,
  SweepRepo,
  SweepSettings,
  SweepStarter,
  SweepStop,
  SweepSummary,
  WatchKeyword,
} from '../sweep/types';

interface KeywordRow {
  readonly id: number;
  readonly keyword: string;
  readonly paused: number;
  readonly added_at: string;
  readonly last_swept_at: string | null;
  readonly found: number;
}

interface SweepRow {
  readonly id: number;
  readonly started_by: SweepStarter;
  readonly via: FindVia;
  readonly requests: number;
  readonly api_units: number;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly stopped: SweepStop | null;
  readonly message: string | null;
  readonly summary_json: string | null;
}

interface FindRow {
  readonly channel_id: string;
  readonly sweep_id: number;
  readonly source: 'keyword' | 'snowball';
  readonly keyword_id: number | null;
  readonly keyword: string | null;
  readonly from_channel_id: string | null;
  readonly qualified: number;
  readonly found_at: string;
}

const KEYWORDS = `
  SELECT k.id, k.keyword, k.paused, k.added_at, k.last_swept_at,
         (SELECT count(*) FROM niche_sweep_finds f
           WHERE f.keyword_id = k.id AND f.qualified = 1) AS found
  FROM niche_keywords k`;

const toKeyword = (row: KeywordRow): WatchKeyword => ({
  id: row.id,
  keyword: row.keyword,
  paused: row.paused === 1,
  addedAt: new Date(row.added_at),
  lastSweptAt: row.last_swept_at === null ? null : new Date(row.last_swept_at),
  found: row.found,
});

const toSweep = (row: SweepRow): StoredSweep => ({
  id: row.id,
  startedBy: row.started_by,
  via: row.via,
  requests: row.requests,
  apiUnits: row.api_units,
  startedAt: new Date(row.started_at),
  finishedAt: row.finished_at === null ? null : new Date(row.finished_at),
  stopped: row.stopped,
  message: row.message,
  summary: row.summary_json === null ? null : (JSON.parse(row.summary_json) as SweepSummary),
});

const toFind = (row: FindRow): SweepFind => ({
  channelId: row.channel_id,
  sweepId: row.sweep_id,
  source: row.source,
  keywordId: row.keyword_id,
  keyword: row.keyword,
  fromChannelId: row.from_channel_id,
  qualified: row.qualified === 1,
  foundAt: new Date(row.found_at),
});

/** The niche watchlist and its sweeps (store step labelled 48, provisional). */
export class SqliteSweepRepo implements SweepRepo {
  constructor(private readonly db: Db) {}

  keywords(): readonly WatchKeyword[] {
    return this.db.prepare<[], KeywordRow>(`${KEYWORDS} ORDER BY k.id`).all().map(toKeyword);
  }

  addKeyword(keyword: string, at: Date): WatchKeyword | null {
    const added = this.db
      .prepare(
        `INSERT INTO niche_keywords (keyword, added_at) VALUES (?, ?)
         ON CONFLICT (keyword) DO NOTHING`,
      )
      .run(keyword, at.toISOString());
    if (added.changes === 0) return null;
    const row = this.db
      .prepare<[number | bigint], KeywordRow>(`${KEYWORDS} WHERE k.id = ?`)
      .get(added.lastInsertRowid);
    return row ? toKeyword(row) : null;
  }

  removeKeyword(id: number): boolean {
    return this.db.prepare('DELETE FROM niche_keywords WHERE id = ?').run(id).changes > 0;
  }

  setPaused(id: number, paused: boolean): boolean {
    const changed = this.db
      .prepare('UPDATE niche_keywords SET paused = ? WHERE id = ?')
      .run(paused ? 1 : 0, id);
    return changed.changes > 0;
  }

  markSwept(id: number, at: Date): void {
    this.db
      .prepare('UPDATE niche_keywords SET last_swept_at = ? WHERE id = ?')
      .run(at.toISOString(), id);
  }

  settings(): SweepSettings {
    const row = this.db
      .prepare<
        [],
        { every_days: number | null; page_budget: number }
      >('SELECT every_days, page_budget FROM niche_sweep_settings WHERE id = 1')
      .get();
    return row
      ? { everyDays: row.every_days, pageBudget: row.page_budget }
      : { everyDays: null, pageBudget: READING_BUDGET_DEFAULT };
  }

  saveSettings(settings: SweepSettings): void {
    this.db
      .prepare(
        `INSERT INTO niche_sweep_settings (id, every_days, page_budget) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET every_days = excluded.every_days,
                                        page_budget = excluded.page_budget`,
      )
      .run(settings.everyDays, settings.pageBudget);
  }

  begin(start: {
    readonly startedBy: SweepStarter;
    readonly via: FindVia;
    readonly startedAt: Date;
  }): number {
    const added = this.db
      .prepare('INSERT INTO niche_sweeps (started_by, via, started_at) VALUES (?, ?, ?)')
      .run(start.startedBy, start.via, start.startedAt.toISOString());
    return Number(added.lastInsertRowid);
  }

  spend(id: number, spent: Pots): void {
    this.db
      .prepare('UPDATE niche_sweeps SET requests = ?, api_units = ? WHERE id = ?')
      .run(spent.pages, spent.units, id);
  }

  finish(id: number, end: SweepEnd): void {
    this.db
      .prepare(
        `UPDATE niche_sweeps SET stopped = ?, message = ?, summary_json = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(end.stopped, end.message, JSON.stringify(end.summary), end.finishedAt.toISOString(), id);
  }

  latest(): StoredSweep | null {
    return this.list(1)[0] ?? null;
  }

  list(limit: number): readonly StoredSweep[] {
    return this.db
      .prepare<[number], SweepRow>('SELECT * FROM niche_sweeps ORDER BY id DESC LIMIT ?')
      .all(limit)
      .map(toSweep);
  }

  spentSince(since: Date): Pots {
    const row = this.db
      .prepare<
        [string],
        { pages: number | null; units: number | null }
      >('SELECT sum(requests) AS pages, sum(api_units) AS units FROM niche_sweeps WHERE started_at >= ?')
      .get(since.toISOString());
    return { pages: row?.pages ?? 0, units: row?.units ?? 0 };
  }

  recordFind(find: SweepFind): void {
    this.db
      .prepare(
        `INSERT INTO niche_sweep_finds
           (channel_id, sweep_id, source, keyword_id, keyword, from_channel_id, qualified, found_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (channel_id) DO NOTHING`,
      )
      .run(
        find.channelId,
        find.sweepId,
        find.source,
        find.keywordId,
        find.keyword,
        find.fromChannelId,
        find.qualified ? 1 : 0,
        find.foundAt.toISOString(),
      );
  }

  finds(): ReadonlyMap<string, SweepFind> {
    const rows = this.db.prepare<[], FindRow>('SELECT * FROM niche_sweep_finds').all();
    return new Map(rows.map((row) => [row.channel_id, toFind(row)]));
  }

  qualifiedSince(since: Date): number {
    const row = this.db
      .prepare<
        [string],
        { found: number }
      >('SELECT count(*) AS found FROM niche_sweep_finds WHERE qualified = 1 AND found_at >= ?')
      .get(since.toISOString());
    return row?.found ?? 0;
  }
}

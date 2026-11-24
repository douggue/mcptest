import type { FindVia } from '../bank/cost';
import type { Db } from '../db/sqlite';

/** One finished "Find more outliers" run, as kept for the daily cap. */
export interface FindRecord {
  readonly query: string;
  readonly via: FindVia;
  readonly requests: number;
  readonly apiUnits: number;
  readonly channelsRead: number;
  readonly startedAt: Date;
  readonly finishedAt: Date;
}

export interface FindRepo {
  record(run: FindRecord): void;
  /** What runs started since then spent: page requests, or API units with `via` 'api'. */
  spentSince(via: FindVia, since: Date): number;
}

/** The outlier bank's find runs (store step 47, provisional). */
export class SqliteFindRepo implements FindRepo {
  constructor(private readonly db: Db) {}

  record(run: FindRecord): void {
    this.db
      .prepare(
        `INSERT INTO outlier_bank_finds
           (query, via, requests, api_units, channels_read, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.query,
        run.via,
        run.requests,
        run.apiUnits,
        run.channelsRead,
        run.startedAt.toISOString(),
        run.finishedAt.toISOString(),
      );
  }

  spentSince(via: FindVia, since: Date): number {
    const column = via === 'api' ? 'api_units' : 'requests';
    const row = this.db
      .prepare<[string, string], { spent: number | null }>(
        `SELECT sum(${column}) AS spent FROM outlier_bank_finds WHERE via = ? AND started_at >= ?`,
      )
      .get(via, since.toISOString());
    return row?.spent ?? 0;
  }
}

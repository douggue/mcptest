import type { Db } from '../db/sqlite';
import type { RefreshRun, RefreshRunRepo } from './types';

interface RunRow {
  started_at: string;
  finished_at: string;
  refreshed: number;
  failed: number;
  stopped_early: number;
}

export class SqliteRefreshRepo implements RefreshRunRepo {
  constructor(private readonly db: Db) {}

  record(run: RefreshRun): void {
    this.db
      .prepare(
        `INSERT INTO refresh_runs (started_at, finished_at, refreshed, failed, stopped_early)
         VALUES (@startedAt, @finishedAt, @refreshed, @failed, @stoppedEarly)`,
      )
      .run({
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt.toISOString(),
        refreshed: run.refreshed,
        failed: run.failed,
        stoppedEarly: run.stoppedEarly ? 1 : 0,
      });
  }

  latest(): RefreshRun | null {
    const row = this.db
      .prepare<[], RunRow>(
        `SELECT started_at, finished_at, refreshed, failed, stopped_early
         FROM refresh_runs ORDER BY finished_at DESC, id DESC LIMIT 1`,
      )
      .get();
    return row
      ? {
          startedAt: new Date(row.started_at),
          finishedAt: new Date(row.finished_at),
          refreshed: row.refreshed,
          failed: row.failed,
          stoppedEarly: row.stopped_early === 1,
        }
      : null;
  }
}

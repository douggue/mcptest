import type { Db } from '../db/sqlite';
import type { LeaseRepo } from './types';

/** The one lease there is: the right to read YouTube. */
const YOUTUBE = 'youtube';

/**
 * The lease as one row in the store, so every program that opens the store
 * (the web app's server, the connector, the command line) sees the same one.
 * Times are ISO-8601 in UTC, which sort as text in time order.
 */
export class SqliteLeaseRepo implements LeaseRepo {
  constructor(private readonly db: Db) {}

  acquire(owner: string, now: Date, expiresAt: Date): boolean {
    // One statement, so two programs asking at once cannot both be told yes.
    const taken = this.db
      .prepare(
        `INSERT INTO work_leases (name, owner, expires_at) VALUES (@name, @owner, @expiresAt)
         ON CONFLICT (name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
         WHERE work_leases.expires_at <= @now`,
      )
      .run({
        name: YOUTUBE,
        owner,
        expiresAt: expiresAt.toISOString(),
        now: now.toISOString(),
      });
    return taken.changes === 1;
  }

  renew(owner: string, expiresAt: Date): boolean {
    const renewed = this.db
      .prepare(`UPDATE work_leases SET expires_at = ? WHERE name = ? AND owner = ?`)
      .run(expiresAt.toISOString(), YOUTUBE, owner);
    return renewed.changes === 1;
  }

  release(owner: string): void {
    this.db.prepare(`DELETE FROM work_leases WHERE name = ? AND owner = ?`).run(YOUTUBE, owner);
  }

  holder(now: Date): string | null {
    const row = this.db
      .prepare<[string, string], { owner: string }>(
        `SELECT owner FROM work_leases WHERE name = ? AND expires_at > ?`,
      )
      .get(YOUTUBE, now.toISOString());
    return row?.owner ?? null;
  }
}

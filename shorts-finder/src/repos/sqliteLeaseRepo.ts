import type { Db } from '../db/sqlite';
import type { LeaseRepo } from './types';

/** The one lease there is: the right to read YouTube. */
const YOUTUBE = 'youtube';

/**
 * The lease as one row in the store, so every program that opens the store
 * (the service, a command run by hand) sees the same one. Times are ISO-8601
 * in UTC, which sort as text in time order.
 */
export class SqliteLeaseRepo implements LeaseRepo {
  constructor(private readonly db: Db) {}

  acquire(owner: string, now: Date, expiresAt: Date): boolean {
    // One statement, so two programs asking at once cannot both be told yes.
    // A lease that runs out more than twice its own length from now was
    // written by a clock that has since been set back: no renewal can reach
    // that far, so it is taken rather than waited for. Twice, not once, so a
    // holder renewing in the same instant is never robbed.
    const length = expiresAt.getTime() - now.getTime();
    const taken = this.db
      .prepare(
        `INSERT INTO work_leases (name, owner, expires_at) VALUES (@name, @owner, @expiresAt)
         ON CONFLICT (name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
         WHERE work_leases.expires_at <= @now OR work_leases.expires_at > @tooFar`,
      )
      .run({
        name: YOUTUBE,
        owner,
        expiresAt: expiresAt.toISOString(),
        now: now.toISOString(),
        tooFar: new Date(expiresAt.getTime() + length).toISOString(),
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

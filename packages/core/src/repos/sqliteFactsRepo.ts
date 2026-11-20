import type { Db } from '../db/sqlite';
import type { FactsRepo, NewFacts, StoredFacts } from './types';

interface FactsRow {
  id: string;
  created_at: string;
  country: string | null;
  total_views: number | null;
  facts_fetched_at: string;
}

/**
 * The facts live in their own columns of the channels table. Reading a channel
 * again from the web pages rewrites the others and leaves these alone.
 */
export class SqliteFactsRepo implements FactsRepo {
  constructor(private readonly db: Db) {}

  find(channelId: string): StoredFacts | null {
    const row = this.db
      .prepare<[string], FactsRow>(
        `SELECT id, created_at, country, total_views, facts_fetched_at
         FROM channels WHERE id = ? AND created_at IS NOT NULL`,
      )
      .get(channelId);
    return row
      ? {
          channelId: row.id,
          createdAt: new Date(row.created_at),
          country: row.country,
          totalViews: row.total_views,
          fetchedAt: new Date(row.facts_fetched_at),
        }
      : null;
  }

  listMissing(channelIds: readonly string[]): readonly string[] {
    const neverAsked = this.db.prepare<[string], { id: string }>(
      'SELECT id FROM channels WHERE id = ? AND facts_fetched_at IS NULL',
    );
    return channelIds.filter((id) => neverAsked.get(id) !== undefined);
  }

  record(askedIds: readonly string[], facts: readonly NewFacts[], fetchedAt: Date): void {
    const markAsked = this.db.prepare('UPDATE channels SET facts_fetched_at = ? WHERE id = ?');
    const store = this.db.prepare(
      `UPDATE channels SET created_at = @createdAt, country = @country, total_views = @totalViews
       WHERE id = @id`,
    );
    const at = fetchedAt.toISOString();
    this.db.transaction(() => {
      for (const id of askedIds) markAsked.run(at, id);
      for (const entry of facts) {
        store.run({
          id: entry.id,
          createdAt: entry.createdAt.toISOString(),
          country: entry.country,
          totalViews: entry.totalViews,
        });
      }
    })();
  }
}

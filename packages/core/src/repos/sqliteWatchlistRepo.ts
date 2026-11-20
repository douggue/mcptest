import type { Db } from '../db/sqlite';
import type { WatchlistRepo } from './types';

export class SqliteWatchlistRepo implements WatchlistRepo {
  constructor(private readonly db: Db) {}

  listWatched(): readonly string[] {
    return this.db
      .prepare<[], { channel_id: string }>(
        'SELECT channel_id FROM niche_watchlist ORDER BY channel_id',
      )
      .all()
      .map((row) => row.channel_id);
  }

  setWatched(channelId: string, watched: boolean, at: Date): void {
    if (watched) {
      this.db
        .prepare(
          `INSERT INTO niche_watchlist (channel_id, watched_at)
           VALUES (?, ?) ON CONFLICT (channel_id) DO NOTHING`,
        )
        .run(channelId, at.toISOString());
    } else {
      this.db.prepare('DELETE FROM niche_watchlist WHERE channel_id = ?').run(channelId);
    }
  }
}

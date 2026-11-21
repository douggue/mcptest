import type { Db } from '../db/sqlite';
import type { OwnerPlaceRepo } from './types';

/** The place the owner chose for a channel of theirs, one row per channel. */
export class SqliteOwnerPlaceRepo implements OwnerPlaceRepo {
  constructor(private readonly db: Db) {}

  find(centerChannelId: string): string | null {
    const row = this.db
      .prepare<[string], { place_key: string }>(
        'SELECT place_key FROM owner_places WHERE center_channel_id = ?',
      )
      .get(centerChannelId);
    return row?.place_key ?? null;
  }

  set(centerChannelId: string, placeKey: string | null, at: Date): void {
    if (placeKey === null) {
      this.db.prepare('DELETE FROM owner_places WHERE center_channel_id = ?').run(centerChannelId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO owner_places (center_channel_id, place_key, set_at) VALUES (?, ?, ?)
         ON CONFLICT (center_channel_id) DO UPDATE SET
           place_key = excluded.place_key, set_at = excluded.set_at`,
      )
      .run(centerChannelId, placeKey, at.toISOString());
  }
}

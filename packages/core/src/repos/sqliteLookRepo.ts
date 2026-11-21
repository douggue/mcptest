import type { EarlierMap, LookRepo } from '../changes/store';
import type { Db } from '../db/sqlite';

interface MapRow {
  id: number;
  created_at: string;
  snapshot_json: string | null;
}

export class SqliteLookRepo implements LookRepo {
  constructor(private readonly db: Db) {}

  lastLook(centerChannelId: string): Date | null {
    const row = this.db
      .prepare<[string], { seen_at: string }>(
        'SELECT seen_at FROM channel_looks WHERE center_channel_id = ?',
      )
      .get(centerChannelId);
    return row ? new Date(row.seen_at) : null;
  }

  markSeen(centerChannelId: string, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO channel_looks (center_channel_id, seen_at) VALUES (?, ?)
         ON CONFLICT (center_channel_id) DO UPDATE SET seen_at = excluded.seen_at`,
      )
      .run(centerChannelId, at.toISOString());
  }

  mapAsOf(centerChannelId: string, at: Date): EarlierMap | null {
    const row = this.db
      .prepare<[string, string], MapRow>(
        `SELECT id, created_at, snapshot_json FROM maps
         WHERE center_channel = ? AND created_at <= ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(centerChannelId, at.toISOString());
    return row
      ? { id: row.id, createdAt: new Date(row.created_at), snapshotJson: row.snapshot_json }
      : null;
  }
}

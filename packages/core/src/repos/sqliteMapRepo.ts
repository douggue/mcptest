import type { Db } from '../db/sqlite';
import type { MapMember, MapRepo, NewMap, StoredMap } from './types';

interface MapRow {
  id: number;
  center_channel: string;
  model_channel: string | null;
  depth: number;
  region: string;
  created_at: string;
}

interface MemberRow {
  channel_id: string;
  steps: number;
}

export class SqliteMapRepo implements MapRepo {
  constructor(private readonly db: Db) {}

  create(map: NewMap, createdAt: Date): number {
    const insertMap = this.db.prepare(
      `INSERT INTO maps (center_channel, model_channel, depth, region, created_at)
       VALUES (@center, @model, @depth, @region, @createdAt)`,
    );
    const insertMember = this.db.prepare(
      `INSERT INTO map_channels (map_id, channel_id, steps, position)
       VALUES (@mapId, @channelId, @steps, @position)`,
    );
    const writeAll = this.db.transaction((): number => {
      const mapId = Number(
        insertMap.run({
          center: map.centerChannelId,
          model: map.modelChannelId ?? null,
          depth: map.depth,
          region: map.region,
          createdAt: createdAt.toISOString(),
        }).lastInsertRowid,
      );
      map.members.forEach((member, position) => {
        insertMember.run({ mapId, channelId: member.channelId, steps: member.steps, position });
      });
      return mapId;
    });
    return writeAll();
  }

  latestForCenter(centerChannelId: string): StoredMap | null {
    const row = this.db
      .prepare<[string], MapRow>(
        `SELECT id, center_channel, model_channel, depth, region, created_at FROM maps
         WHERE center_channel = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(centerChannelId);
    if (!row) return null;
    const members: readonly MapMember[] = this.db
      .prepare<[number], MemberRow>(
        `SELECT channel_id, steps FROM map_channels
         WHERE map_id = ? ORDER BY steps, position`,
      )
      .all(row.id)
      .map((member) => ({ channelId: member.channel_id, steps: member.steps }));
    return {
      id: row.id,
      centerChannelId: row.center_channel,
      modelChannelId: row.model_channel,
      depth: row.depth,
      region: row.region,
      createdAt: new Date(row.created_at),
      members,
    };
  }

  listCenterIds(): readonly string[] {
    return this.db
      .prepare<[], { center_channel: string }>(
        'SELECT DISTINCT center_channel FROM maps ORDER BY center_channel',
      )
      .all()
      .map((row) => row.center_channel);
  }

  saveSnapshot(mapId: number, snapshotJson: string): void {
    this.db.prepare('UPDATE maps SET snapshot_json = ? WHERE id = ?').run(snapshotJson, mapId);
  }

  findSnapshot(mapId: number): string | null {
    const row = this.db
      .prepare<[number], { snapshot_json: string | null }>(
        'SELECT snapshot_json FROM maps WHERE id = ?',
      )
      .get(mapId);
    return row?.snapshot_json ?? null;
  }

  listRemoved(centerChannelId: string): readonly string[] {
    return this.db
      .prepare<[string], { channel_id: string }>(
        'SELECT channel_id FROM map_removals WHERE center_channel = ? ORDER BY channel_id',
      )
      .all(centerChannelId)
      .map((row) => row.channel_id);
  }

  setRemoved(centerChannelId: string, channelId: string, removed: boolean, at: Date): void {
    if (removed) {
      this.db
        .prepare(
          `INSERT INTO map_removals (center_channel, channel_id, removed_at)
           VALUES (?, ?, ?) ON CONFLICT (center_channel, channel_id) DO NOTHING`,
        )
        .run(centerChannelId, channelId, at.toISOString());
    } else {
      this.db
        .prepare('DELETE FROM map_removals WHERE center_channel = ? AND channel_id = ?')
        .run(centerChannelId, channelId);
    }
  }
}

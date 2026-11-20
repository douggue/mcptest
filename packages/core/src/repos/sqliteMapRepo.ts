import type { Db } from '../db/sqlite';
import type { MapMember, MapRepo, NewMap, StoredMap } from './types';

interface MapRow {
  id: number;
  center_channel: string;
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
      `INSERT INTO maps (center_channel, depth, region, created_at)
       VALUES (@center, @depth, @region, @createdAt)`,
    );
    const insertMember = this.db.prepare(
      `INSERT INTO map_channels (map_id, channel_id, steps, position)
       VALUES (@mapId, @channelId, @steps, @position)`,
    );
    const writeAll = this.db.transaction((): number => {
      const mapId = Number(
        insertMap.run({
          center: map.centerChannelId,
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
        `SELECT id, center_channel, depth, region, created_at FROM maps
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
      depth: row.depth,
      region: row.region,
      createdAt: new Date(row.created_at),
      members,
    };
  }
}

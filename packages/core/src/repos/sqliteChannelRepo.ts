import type { Db } from '../db/sqlite';
import type { ChannelInfo } from '../sources/types';
import type { ChannelRepo, StoredChannel } from './types';

interface ChannelRow {
  id: string;
  title: string;
  handle: string | null;
  subscribers: number | null;
  subs_hidden: number;
  video_count: number | null;
  fetched_at: string;
}

const COLUMNS = 'id, title, handle, subscribers, subs_hidden, video_count, fetched_at';

function toChannel(row: ChannelRow): StoredChannel {
  return {
    id: row.id,
    title: row.title,
    handle: row.handle,
    subscribers: row.subscribers,
    subscribersHidden: row.subs_hidden === 1,
    videoCount: row.video_count,
    fetchedAt: new Date(row.fetched_at),
  };
}

export class SqliteChannelRepo implements ChannelRepo {
  constructor(private readonly db: Db) {}

  findById(id: string): StoredChannel | null {
    const row = this.db
      .prepare<[string], ChannelRow>(`SELECT ${COLUMNS} FROM channels WHERE id = ?`)
      .get(id);
    return row ? toChannel(row) : null;
  }

  findByHandle(handle: string): StoredChannel | null {
    const row = this.db
      .prepare<[string], ChannelRow>(
        `SELECT ${COLUMNS} FROM channels WHERE handle_lower = ? ORDER BY fetched_at DESC, id LIMIT 1`,
      )
      .get(handle.toLowerCase());
    return row ? toChannel(row) : null;
  }

  listAll(): readonly StoredChannel[] {
    return this.db
      .prepare<[], ChannelRow>(`SELECT ${COLUMNS} FROM channels ORDER BY id`)
      .all()
      .map(toChannel);
  }

  upsert(channel: ChannelInfo, fetchedAt: Date): void {
    this.db
      .prepare(
        `INSERT INTO channels (id, title, handle, handle_lower, subscribers, subs_hidden, video_count, fetched_at)
         VALUES (@id, @title, @handle, @handleLower, @subscribers, @subsHidden, @videoCount, @fetchedAt)
         ON CONFLICT (id) DO UPDATE SET
           title = excluded.title,
           handle = COALESCE(excluded.handle, channels.handle),
           handle_lower = COALESCE(excluded.handle_lower, channels.handle_lower),
           subscribers = excluded.subscribers,
           subs_hidden = excluded.subs_hidden,
           video_count = excluded.video_count,
           fetched_at = excluded.fetched_at`,
      )
      .run({
        id: channel.id,
        title: channel.title,
        handle: channel.handle,
        handleLower: channel.handle?.toLowerCase() ?? null,
        subscribers: channel.subscribers,
        subsHidden: channel.subscribersHidden ? 1 : 0,
        videoCount: channel.videoCount,
        fetchedAt: fetchedAt.toISOString(),
      });
  }
}

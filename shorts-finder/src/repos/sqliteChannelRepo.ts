import type { Db } from '../db/sqlite';
import type { ChannelFacts } from '../youtube/dataApi';
import { fromText, fromTextOrNull, toText } from './rows';
import type { ChannelReadRequest, ChannelRepo, StoredChannel } from './types';

interface ChannelRow {
  readonly id: string;
  readonly title: string | null;
  readonly country: string | null;
  readonly created_at: string | null;
  readonly subscribers: number | null;
  readonly subs_hidden: number;
  readonly video_count: number | null;
  readonly total_views: number | null;
  readonly uploads_playlist_id: string | null;
  readonly fetched_at: string;
  readonly read_queued_at: string | null;
  readonly followed: number;
  readonly last_tracked_upload_at: string | null;
  readonly uploads_read_at: string | null;
}

const toChannel = (row: ChannelRow): StoredChannel => ({
  id: row.id,
  title: row.title,
  country: row.country,
  createdAt: fromTextOrNull(row.created_at),
  subscribers: row.subscribers,
  subscribersHidden: row.subs_hidden === 1,
  videoCount: row.video_count,
  totalViews: row.total_views,
  uploadsPlaylistId: row.uploads_playlist_id,
  fetchedAt: fromText(row.fetched_at),
  readQueuedAt: fromTextOrNull(row.read_queued_at),
  followed: row.followed === 1,
  lastTrackedUploadAt: fromTextOrNull(row.last_tracked_upload_at),
  uploadsReadAt: fromTextOrNull(row.uploads_read_at),
});

/**
 * Channels in the store. A channel gets a row as soon as one of its videos is
 * found, before its facts are read: a video cannot be stored without its
 * channel, and the facts are paid for from another share of the allowance,
 * which may be spent. Such a row has no creation date yet and waits in the queue.
 */
export class SqliteChannelRepo implements ChannelRepo {
  constructor(private readonly db: Db) {}

  upsert(channel: ChannelFacts, fetchedAt: Date): void {
    this.db
      .prepare(
        `INSERT INTO channels (id, title, country, created_at, subscribers, subs_hidden,
           video_count, total_views, uploads_playlist_id, fetched_at, read_queued_at)
         VALUES (@id, @title, @country, @createdAt, @subscribers, @subsHidden,
           @videoCount, @totalViews, @uploadsPlaylistId, @fetchedAt, NULL)
         ON CONFLICT (id) DO UPDATE SET
           title = excluded.title, country = excluded.country, created_at = excluded.created_at,
           subscribers = excluded.subscribers, subs_hidden = excluded.subs_hidden,
           video_count = excluded.video_count, total_views = excluded.total_views,
           uploads_playlist_id = excluded.uploads_playlist_id, fetched_at = excluded.fetched_at,
           read_queued_at = NULL, read_attempts = 0`,
      )
      .run({
        id: channel.id,
        title: channel.title,
        country: channel.country,
        createdAt: toText(channel.createdAt),
        subscribers: channel.subscribers,
        subsHidden: channel.subscribersHidden ? 1 : 0,
        videoCount: channel.videoCount,
        totalViews: channel.totalViews,
        uploadsPlaylistId: channel.uploadsPlaylistId,
        fetchedAt: toText(fetchedAt),
      });
  }

  queueRead(request: ChannelReadRequest): boolean {
    // One statement: a new channel gets a row and a place in the queue; a known
    // one is queued only when it is not waiting already and its facts are stale.
    const queued = this.db
      .prepare(
        `INSERT INTO channels (id, title, subs_hidden, fetched_at, read_queued_at)
         VALUES (@id, @title, 0, @now, @now)
         ON CONFLICT (id) DO UPDATE SET read_queued_at = @now
         WHERE channels.read_queued_at IS NULL AND channels.fetched_at <= @staleBefore`,
      )
      .run({
        id: request.id,
        title: request.title,
        now: toText(request.now),
        staleBefore: toText(request.staleBefore),
      });
    return queued.changes === 1;
  }

  listQueued(): readonly string[] {
    return this.db
      .prepare<[], { id: string }>(
        `SELECT id FROM channels WHERE read_queued_at IS NOT NULL ORDER BY read_queued_at, id`,
      )
      .all()
      .map((row) => row.id);
  }

  markUnavailable(id: string, at: Date): void {
    this.db
      .prepare(
        `UPDATE channels SET read_queued_at = NULL, read_attempts = 0, fetched_at = ? WHERE id = ?`,
      )
      .run(toText(at), id);
  }

  countFailedRead(id: string): number {
    const row = this.db
      .prepare<[string], { read_attempts: number }>(
        `UPDATE channels SET read_attempts = read_attempts + 1 WHERE id = ? RETURNING read_attempts`,
      )
      .get(id);
    return row?.read_attempts ?? 0;
  }

  get(id: string): StoredChannel | null {
    const row = this.db
      .prepare<[string], ChannelRow>('SELECT * FROM channels WHERE id = ?')
      .get(id);
    return row === undefined ? null : toChannel(row);
  }
}

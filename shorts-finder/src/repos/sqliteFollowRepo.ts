import type { Db } from '../db/sqlite';
import { toText } from './rows';
import type { FeedRead, FollowRepo, FollowedChannel } from './types';

interface FollowedRow {
  readonly id: string;
  readonly uploads_playlist_id: string | null;
  readonly feed_etag: string | null;
  readonly feed_modified: string | null;
  readonly feed_failures: number;
}

const toFollowed = (row: FollowedRow): FollowedChannel => ({
  id: row.id,
  uploadsPlaylistId: row.uploads_playlist_id,
  feedEtag: row.feed_etag,
  feedModified: row.feed_modified,
  feedFailures: row.feed_failures,
});

const COLUMNS = 'id, uploads_playlist_id, feed_etag, feed_modified, feed_failures';

/**
 * Which channels are followed, kept on the channel's own row. A time "after
 * now" in any of the due checks means the clock was set back since it was
 * written; it counts as long ago, so nothing waits for the clock to catch up.
 */
export class SqliteFollowRepo implements FollowRepo {
  constructor(private readonly db: Db) {}

  setFollowed(id: string, followed: boolean, at: Date): void {
    if (!followed) {
      this.db.prepare('UPDATE channels SET followed = 0 WHERE id = ?').run(id);
      return;
    }
    this.db
      .prepare(
        `UPDATE channels SET followed = 1,
           followed_at = CASE WHEN followed = 1 THEN followed_at ELSE @at END,
           last_tracked_upload_at = COALESCE(last_tracked_upload_at, @at)
         WHERE id = @id`,
      )
      .run({ id, at: toText(at) });
  }

  noteTrackedUpload(id: string, at: Date): void {
    this.db
      .prepare('UPDATE channels SET last_tracked_upload_at = ? WHERE id = ?')
      .run(toText(at), id);
  }

  listFeedDue(now: Date, checkedBefore: Date, limit: number): readonly FollowedChannel[] {
    return this.db
      .prepare<{ now: string; checkedBefore: string; limit: number }, FollowedRow>(
        `SELECT ${COLUMNS} FROM channels
         WHERE followed = 1
           AND (feed_checked_at IS NULL OR feed_checked_at <= @checkedBefore
             OR feed_checked_at > @now)
           AND (feed_retry_at IS NULL OR feed_retry_at <= @now)
         ORDER BY feed_checked_at IS NOT NULL, feed_checked_at, id LIMIT @limit`,
      )
      .all({ now: toText(now), checkedBefore: toText(checkedBefore), limit })
      .map(toFollowed);
  }

  noteFeedRead(id: string, read: FeedRead): void {
    this.db
      .prepare(
        `UPDATE channels SET feed_checked_at = @at, uploads_read_at = @at, feed_failures = 0,
           feed_retry_at = NULL, feed_etag = @etag, feed_modified = @modified WHERE id = @id`,
      )
      .run({ id, at: toText(read.at), etag: read.etag, modified: read.modified });
  }

  noteFeedFailure(id: string, at: Date, retryAt: Date): number {
    const row = this.db
      .prepare<[string, string, string], { feed_failures: number }>(
        `UPDATE channels SET feed_checked_at = ?, feed_retry_at = ?,
           feed_failures = feed_failures + 1 WHERE id = ? RETURNING feed_failures`,
      )
      .get(toText(at), toText(retryAt), id);
    return row?.feed_failures ?? 0;
  }

  listUploadsDue(now: Date, readBefore: Date, limit: number): readonly FollowedChannel[] {
    return this.db
      .prepare<{ now: string; readBefore: string; limit: number }, FollowedRow>(
        `SELECT ${COLUMNS} FROM channels
         WHERE followed = 1 AND feed_failures > 0 AND uploads_playlist_id IS NOT NULL
           AND (uploads_read_at IS NULL OR uploads_read_at <= @readBefore
             OR uploads_read_at > @now)
         ORDER BY uploads_read_at IS NOT NULL, uploads_read_at, id LIMIT @limit`,
      )
      .all({ now: toText(now), readBefore: toText(readBefore), limit })
      .map(toFollowed);
  }

  noteUploadsRead(id: string, at: Date): void {
    this.db.prepare('UPDATE channels SET uploads_read_at = ? WHERE id = ?').run(toText(at), id);
  }

  unfollowIdle(cutoff: Date): number {
    return this.db
      .prepare(
        `UPDATE channels SET followed = 0
         WHERE followed = 1
           AND COALESCE(last_tracked_upload_at, followed_at) < @cutoff
           AND COALESCE(followed_at, last_tracked_upload_at) < @cutoff`,
      )
      .run({ cutoff: toText(cutoff) }).changes;
  }

  countFollowed(): number {
    const row = this.db
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM channels WHERE followed = 1')
      .get();
    return row?.n ?? 0;
  }
}

import type { Db } from '../db/sqlite';
import { fromSeconds, toSeconds } from './rows';
import type { Reading, ReadingRepo } from './types';

interface ReadingRow {
  readonly captured_at: number;
  readonly views: number;
  readonly source: 'feed' | null;
  readonly likes: number | null;
  readonly comments: number | null;
}

/**
 * Readings of view counts: by far the most rows in the store. Moments are
 * whole seconds since 1970, and the table is ordered by video and moment, so a
 * video's readings in a window are read in one sweep.
 */
export class SqliteReadingRepo implements ReadingRepo {
  constructor(private readonly db: Db) {}

  add(reading: Reading): void {
    this.db
      .prepare(
        `INSERT INTO video_snapshots (video_id, captured_at, views, source, likes, comments)
         VALUES (@videoId, @capturedAt, @views, @source, @likes, @comments)
         ON CONFLICT (video_id, captured_at) DO UPDATE SET views = excluded.views,
           source = excluded.source, likes = excluded.likes, comments = excluded.comments`,
      )
      .run({
        videoId: reading.videoId,
        capturedAt: toSeconds(reading.capturedAt),
        views: reading.views,
        source: reading.source ?? null,
        likes: reading.likes ?? null,
        comments: reading.comments ?? null,
      });
  }

  list(videoId: string, from: Date, to: Date): readonly Reading[] {
    return this.db
      .prepare<[string, number, number], ReadingRow>(
        `SELECT captured_at, views, source, likes, comments FROM video_snapshots
         WHERE video_id = ? AND captured_at >= ? AND captured_at <= ? ORDER BY captured_at`,
      )
      .all(videoId, toSeconds(from), toSeconds(to))
      .map((row) => ({
        videoId,
        capturedAt: fromSeconds(row.captured_at),
        views: row.views,
        ...(row.source === null ? {} : { source: row.source }),
        ...(row.likes === null ? {} : { likes: row.likes }),
        ...(row.comments === null ? {} : { comments: row.comments }),
      }));
  }

  deleteForVideo(videoId: string): number {
    return this.db.prepare('DELETE FROM video_snapshots WHERE video_id = ?').run(videoId).changes;
  }
}

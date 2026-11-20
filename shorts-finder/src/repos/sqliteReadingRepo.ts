import type { Db } from '../db/sqlite';
import { fromSeconds, toSeconds } from './rows';
import type { Reading, ReadingRepo } from './types';

/** The days readings are thinned to are days in UTC, this many seconds long. */
const SECONDS_PER_DAY = 86_400;

interface ReadingRow {
  readonly captured_at: number;
  readonly views: number;
  readonly source: 'feed' | null;
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
        `INSERT INTO video_snapshots (video_id, captured_at, views, source) VALUES (?, ?, ?, ?)
         ON CONFLICT (video_id, captured_at) DO UPDATE SET
           views = excluded.views, source = excluded.source`,
      )
      .run(reading.videoId, toSeconds(reading.capturedAt), reading.views, reading.source ?? null);
  }

  list(videoId: string, from: Date, to: Date): readonly Reading[] {
    return this.db
      .prepare<[string, number, number], ReadingRow>(
        `SELECT captured_at, views, source FROM video_snapshots
         WHERE video_id = ? AND captured_at >= ? AND captured_at <= ? ORDER BY captured_at`,
      )
      .all(videoId, toSeconds(from), toSeconds(to))
      .map((row) => ({
        videoId,
        capturedAt: fromSeconds(row.captured_at),
        views: row.views,
        ...(row.source === null ? {} : { source: row.source }),
      }));
  }

  rollUpOlderThan(cutoff: Date): number {
    // An old reading goes when the same video has a later one on the same UTC
    // day, so each day keeps its last. The old rows are found through the
    // index on the moment, and the later one through the primary key. The day's
    // length is written into the statement: a bound number would arrive as a
    // fraction and turn the whole-number division into an exact one.
    return this.db
      .prepare(
        `DELETE FROM video_snapshots
         WHERE captured_at < @cutoff AND EXISTS (
           SELECT 1 FROM video_snapshots later
           WHERE later.video_id = video_snapshots.video_id
             AND later.captured_at > video_snapshots.captured_at
             AND later.captured_at < (video_snapshots.captured_at / ${SECONDS_PER_DAY} + 1) * ${SECONDS_PER_DAY})`,
      )
      .run({ cutoff: toSeconds(cutoff) }).changes;
  }

  deleteForVideo(videoId: string): number {
    return this.db.prepare('DELETE FROM video_snapshots WHERE video_id = ?').run(videoId).changes;
  }
}

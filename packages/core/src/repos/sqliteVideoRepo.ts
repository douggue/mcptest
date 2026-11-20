import type { Db } from '../db/sqlite';
import type { DatePrecision, StorableVideo } from '../sources/types';
import type { StoredVideo, VideoReading, VideoRepo, ViewSnapshot } from './types';

interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  views: number;
  duration_s: number | null;
  published_at: string;
  published_precision: DatePrecision;
  published_raw: string;
  fetched_at: string;
}

interface SnapshotRow {
  captured_at: string;
  views: number;
}

interface ReadingRow extends SnapshotRow {
  video_id: string;
}

function toVideo(row: VideoRow): StoredVideo {
  return {
    id: row.id,
    channelId: row.channel_id,
    title: row.title,
    views: row.views,
    durationSeconds: row.duration_s,
    published: {
      date: new Date(row.published_at),
      precision: row.published_precision,
      raw: row.published_raw,
    },
    fetchedAt: new Date(row.fetched_at),
  };
}

export class SqliteVideoRepo implements VideoRepo {
  constructor(private readonly db: Db) {}

  listByChannel(channelId: string): readonly StoredVideo[] {
    return this.db
      .prepare<[string], VideoRow>(
        `SELECT id, channel_id, title, views, duration_s, published_at,
                published_precision, published_raw, fetched_at
         FROM videos WHERE channel_id = ? ORDER BY published_at DESC, id`,
      )
      .all(channelId)
      .map(toVideo);
  }

  /**
   * The publish date is kept from the first time a video is seen. Relative dates
   * get coarser as a video ages, so the first reading is the most precise.
   */
  upsertMany(videos: readonly StorableVideo[], fetchedAt: Date): void {
    const upsertVideo = this.db.prepare(
      `INSERT INTO videos (id, channel_id, title, views, duration_s, published_at,
                           published_precision, published_raw, fetched_at)
       VALUES (@id, @channelId, @title, @views, @durationSeconds, @publishedAt,
               @publishedPrecision, @publishedRaw, @fetchedAt)
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title,
         views = excluded.views,
         duration_s = excluded.duration_s,
         fetched_at = excluded.fetched_at`,
    );
    const addSnapshot = this.db.prepare(
      `INSERT OR REPLACE INTO video_snapshots (video_id, captured_at, views)
       VALUES (@id, @fetchedAt, @views)`,
    );
    const fetchedAtIso = fetchedAt.toISOString();
    const writeAll = this.db.transaction((batch: readonly StorableVideo[]) => {
      for (const video of batch) {
        upsertVideo.run({
          id: video.id,
          channelId: video.channelId,
          title: video.title,
          views: video.views,
          durationSeconds: video.durationSeconds,
          publishedAt: video.published.date.toISOString(),
          publishedPrecision: video.published.precision,
          publishedRaw: video.published.raw,
          fetchedAt: fetchedAtIso,
        });
        addSnapshot.run({ id: video.id, fetchedAt: fetchedAtIso, views: video.views });
      }
    });
    writeAll(videos);
  }

  listSnapshots(videoId: string): readonly ViewSnapshot[] {
    return this.db
      .prepare<[string], SnapshotRow>(
        `SELECT captured_at, views FROM video_snapshots
         WHERE video_id = ? ORDER BY captured_at`,
      )
      .all(videoId)
      .map((row) => ({ capturedAt: new Date(row.captured_at), views: row.views }));
  }

  listChannelReadings(channelId: string, since: Date): readonly VideoReading[] {
    return this.db
      .prepare<[string, string], ReadingRow>(
        `SELECT s.video_id, s.captured_at, s.views
         FROM video_snapshots s JOIN videos v ON v.id = s.video_id
         WHERE v.channel_id = ? AND s.captured_at >= ?
         ORDER BY s.captured_at, s.video_id`,
      )
      .all(channelId, since.toISOString())
      .map((row) => ({
        videoId: row.video_id,
        capturedAt: new Date(row.captured_at),
        views: row.views,
      }));
  }
}

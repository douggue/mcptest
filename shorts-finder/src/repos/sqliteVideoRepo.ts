import type { Db } from '../db/sqlite';
import type { VideoFacts } from '../youtube/dataApi';
import { fromText, toText } from './rows';
import type { StoredVideo, VideoRepo } from './types';

interface VideoRow {
  readonly id: string;
  readonly channel_id: string;
  readonly title: string;
  readonly views: number | null;
  readonly duration_s: number | null;
  readonly published_at: string;
  readonly category_id: string | null;
  readonly default_language: string | null;
  readonly default_audio_language: string | null;
  readonly fetched_at: string;
  readonly likes: number | null;
  readonly comments: number | null;
}

const toVideo = (row: VideoRow): StoredVideo => ({
  id: row.id,
  channelId: row.channel_id,
  title: row.title,
  publishedAt: fromText(row.published_at),
  durationSeconds: row.duration_s,
  categoryId: row.category_id,
  defaultLanguage: row.default_language,
  defaultAudioLanguage: row.default_audio_language,
  views: row.views,
  likes: row.likes,
  comments: row.comments,
  fetchedAt: fromText(row.fetched_at),
});

/** Videos in the store, as the official API last described them. */
export class SqliteVideoRepo implements VideoRepo {
  constructor(private readonly db: Db) {}

  upsert(video: VideoFacts, fetchedAt: Date): void {
    this.db
      .prepare(
        `INSERT INTO videos (id, channel_id, title, views, likes, comments, duration_s,
           published_at, category_id, default_language, default_audio_language, fetched_at)
         VALUES (@id, @channelId, @title, @views, @likes, @comments, @durationSeconds,
           @publishedAt, @categoryId, @defaultLanguage, @defaultAudioLanguage, @fetchedAt)
         ON CONFLICT (id) DO UPDATE SET
           channel_id = excluded.channel_id, title = excluded.title, views = excluded.views,
           likes = excluded.likes, comments = excluded.comments,
           duration_s = excluded.duration_s, published_at = excluded.published_at,
           category_id = excluded.category_id, default_language = excluded.default_language,
           default_audio_language = excluded.default_audio_language,
           fetched_at = excluded.fetched_at`,
      )
      .run({ ...video, publishedAt: toText(video.publishedAt), fetchedAt: toText(fetchedAt) });
  }

  get(id: string): StoredVideo | null {
    const row = this.db.prepare<[string], VideoRow>('SELECT * FROM videos WHERE id = ?').get(id);
    return row === undefined ? null : toVideo(row);
  }

  knownIds(ids: readonly string[]): readonly string[] {
    if (ids.length === 0) return [];
    // The ids travel as one JSON value, so any number of them is one statement.
    return this.db
      .prepare<[string], { id: string }>(
        `SELECT id FROM videos WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`,
      )
      .all(JSON.stringify(ids))
      .map((row) => row.id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM videos WHERE id = ?').run(id).changes === 1;
  }

  deleteFinishedBefore(cutoff: Date): number {
    // A video goes when its tracking ended before the cutoff, or when it was
    // never tracked and has not been read since; never one a finding is about.
    return this.db
      .prepare(
        `DELETE FROM videos
         WHERE NOT EXISTS (SELECT 1 FROM findings f WHERE f.video_id = videos.id)
           AND (EXISTS (SELECT 1 FROM video_tracking t
                        WHERE t.video_id = videos.id AND t.finished_at < @cutoff)
             OR (videos.fetched_at < @cutoff
               AND NOT EXISTS (SELECT 1 FROM video_tracking t WHERE t.video_id = videos.id)))`,
      )
      .run({ cutoff: toText(cutoff) }).changes;
  }
}

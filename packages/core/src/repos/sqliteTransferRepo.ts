import type { Db } from '../db/sqlite';
import type { RecentVideo } from '../transfer/types';
import type { SavedIdea, TransferRepo } from './types';

interface RecentRow {
  id: string;
  channel_id: string;
  title: string;
  views: number;
  duration_s: number | null;
  published_at: string;
  channel_title: string;
  subscribers: number | null;
  country: string | null;
}

interface SavedRow {
  idea_key: string;
  template: string;
  saved_at: string;
}

export class SqliteTransferRepo implements TransferRepo {
  constructor(private readonly db: Db) {}

  listRecentVideos(since: Date): readonly RecentVideo[] {
    return this.db
      .prepare<[string], RecentRow>(
        `SELECT v.id, v.channel_id, v.title, v.views, v.duration_s, v.published_at,
                c.title AS channel_title, c.subscribers, c.country
         FROM videos v JOIN channels c ON c.id = v.channel_id
         WHERE v.published_at >= ? ORDER BY v.id`,
      )
      .all(since.toISOString())
      .map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        title: row.title,
        views: row.views,
        durationSeconds: row.duration_s,
        publishedAt: new Date(row.published_at),
        channelTitle: row.channel_title,
        subscribers: row.subscribers,
        country: row.country,
      }));
  }

  listSaved(): readonly SavedIdea[] {
    return this.db
      .prepare<[], SavedRow>(
        'SELECT idea_key, template, saved_at FROM transfer_saves ORDER BY idea_key',
      )
      .all()
      .map((row) => ({
        key: row.idea_key,
        template: row.template,
        savedAt: new Date(row.saved_at),
      }));
  }

  setSaved(key: string, template: string, saved: boolean, at: Date): void {
    if (saved) {
      this.db
        .prepare(
          `INSERT INTO transfer_saves (idea_key, template, saved_at)
           VALUES (?, ?, ?) ON CONFLICT (idea_key) DO NOTHING`,
        )
        .run(key, template, at.toISOString());
    } else {
      this.db.prepare('DELETE FROM transfer_saves WHERE idea_key = ?').run(key);
    }
  }
}

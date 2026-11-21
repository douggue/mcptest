import type { Db } from '../db/sqlite';
import type { VideoLink, VideoLinkRepo } from '../plan/store';

interface LinkRow {
  concept_id: number;
  center_channel_id: string;
  video_id: string;
  linked_at: string;
}

export class SqliteVideoLinkRepo implements VideoLinkRepo {
  constructor(private readonly db: Db) {}

  link(
    centerChannelId: string,
    conceptId: number,
    videoId: string,
    at: Date,
  ): 'linked' | 'video-taken' {
    const taken = this.db
      .prepare<[string, string, number], { concept_id: number }>(
        `SELECT concept_id FROM concept_videos
         WHERE center_channel_id = ? AND video_id = ? AND concept_id <> ?`,
      )
      .get(centerChannelId, videoId, conceptId);
    if (taken) return 'video-taken';
    this.db
      .prepare(
        `INSERT INTO concept_videos (concept_id, center_channel_id, video_id, linked_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (concept_id) DO UPDATE SET
           video_id = excluded.video_id, linked_at = excluded.linked_at`,
      )
      .run(conceptId, centerChannelId, videoId, at.toISOString());
    return 'linked';
  }

  unlink(centerChannelId: string, conceptId: number): boolean {
    return (
      this.db
        .prepare('DELETE FROM concept_videos WHERE center_channel_id = ? AND concept_id = ?')
        .run(centerChannelId, conceptId).changes > 0
    );
  }

  list(centerChannelId: string): readonly VideoLink[] {
    return this.db
      .prepare<[string], LinkRow>(
        `SELECT concept_id, center_channel_id, video_id, linked_at FROM concept_videos
         WHERE center_channel_id = ? ORDER BY linked_at DESC, concept_id DESC`,
      )
      .all(centerChannelId)
      .map((row) => ({
        conceptId: row.concept_id,
        centerChannelId: row.center_channel_id,
        videoId: row.video_id,
        linkedAt: new Date(row.linked_at),
      }));
  }
}

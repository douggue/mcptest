import type { Db } from '../db/sqlite';
import type {
  StoredThumbReview,
  ThumbAnswer,
  ThumbComparison,
  ThumbReviewRepo,
} from '../thumbReview/store';
import { readComparison } from '../thumbReview/store';
import { thumbTagsSchema, type ThumbTags } from '../thumbReview/tags';

interface TagRow {
  video_id: string;
  tags_json: string;
}

interface ReviewRow {
  comparison_json: string;
  compared_at: string;
  answer_text: string | null;
  prompt: string | null;
  engine: string | null;
  written_at: string | null;
}

/** Stored JSON as data; null when it cannot be read, so a damaged row reads as nothing kept. */
function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function answerOf(row: ReviewRow): ThumbAnswer | null {
  if (row.answer_text === null || row.engine === null || row.written_at === null) return null;
  return {
    text: row.answer_text,
    prompt: row.prompt,
    engine: row.engine,
    writtenAt: new Date(row.written_at),
  };
}

export class SqliteThumbReviewRepo implements ThumbReviewRepo {
  constructor(private readonly db: Db) {}

  tagsFor(videoIds: readonly string[]): ReadonlyMap<string, ThumbTags> {
    if (videoIds.length === 0) return new Map();
    const marks = videoIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare<string[], TagRow>(
        `SELECT video_id, tags_json FROM thumbnail_tags WHERE video_id IN (${marks})`,
      )
      .all(...videoIds);
    return new Map(
      rows.flatMap((row) => {
        const parsed = thumbTagsSchema.safeParse(jsonOf(row.tags_json));
        return parsed.success ? [[row.video_id, parsed.data] as const] : [];
      }),
    );
  }

  saveTags(videoId: string, tags: ThumbTags, engine: string, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO thumbnail_tags (video_id, tags_json, engine, tagged_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (video_id) DO UPDATE SET
           tags_json = excluded.tags_json, engine = excluded.engine, tagged_at = excluded.tagged_at`,
      )
      .run(videoId, JSON.stringify(tags), engine, at.toISOString());
  }

  find(centerChannelId: string, videoId: string): StoredThumbReview | null {
    const row = this.db
      .prepare<[string, string], ReviewRow>(
        `SELECT comparison_json, compared_at, answer_text, prompt, engine, written_at
         FROM thumbnail_reviews WHERE center_channel_id = ? AND video_id = ?`,
      )
      .get(centerChannelId, videoId);
    if (!row) return null;
    const comparison = readComparison(jsonOf(row.comparison_json));
    if (!comparison) return null;
    return { comparison, comparedAt: new Date(row.compared_at), answer: answerOf(row) };
  }

  saveComparison(centerChannelId: string, comparison: ThumbComparison, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO thumbnail_reviews (center_channel_id, video_id, comparison_json, compared_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (center_channel_id, video_id) DO UPDATE SET
           comparison_json = excluded.comparison_json, compared_at = excluded.compared_at,
           answer_text = NULL, prompt = NULL, engine = NULL, written_at = NULL`,
      )
      .run(
        centerChannelId,
        comparison.target.videoId,
        JSON.stringify(comparison),
        at.toISOString(),
      );
  }

  saveAnswer(centerChannelId: string, videoId: string, answer: ThumbAnswer): void {
    this.db
      .prepare(
        `UPDATE thumbnail_reviews SET answer_text = ?, prompt = ?, engine = ?, written_at = ?
         WHERE center_channel_id = ? AND video_id = ?`,
      )
      .run(
        answer.text,
        answer.prompt,
        answer.engine,
        answer.writtenAt.toISOString(),
        centerChannelId,
        videoId,
      );
  }

  reviewed(centerChannelId: string): readonly string[] {
    return this.db
      .prepare<[string], { video_id: string }>(
        `SELECT video_id FROM thumbnail_reviews WHERE center_channel_id = ?
         ORDER BY compared_at DESC`,
      )
      .all(centerChannelId)
      .map((row) => row.video_id);
  }
}

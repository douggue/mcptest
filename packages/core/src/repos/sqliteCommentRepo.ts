import { z } from 'zod';
import { FINDING_KINDS } from '../comments/findings';
import type { CommentRead, CommentRepo, StoredComment, ViewerAnswer } from '../comments/store';
import type { Db } from '../db/sqlite';
import type { CommentsResult } from '../sources/commentsApi';

interface CommentRow {
  comment_id: string;
  video_id: string;
  text: string;
  likes: number;
  published_at: string;
}

interface ReadRow {
  video_id: string;
  status: CommentRead['status'];
  count: number;
  read_at: string;
}

interface AnswerRow {
  video_ids_json: string;
  findings_json: string;
  engine: string;
  asked_at: string;
}

/** Checked again when read, as every list kept as JSON is. */
const findingsSchema = z.array(
  z.object({
    kind: z.enum(FINDING_KINDS),
    says: z.string(),
    commentIds: z.array(z.string()),
  }),
);
const idsSchema = z.array(z.string());

/** Stored JSON as data; null when it cannot be read, so a damaged row reads as no answer. */
function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

export class SqliteCommentRepo implements CommentRepo {
  constructor(private readonly db: Db) {}

  saveRead(videoId: string, result: CommentsResult, at: Date): void {
    const time = at.toISOString();
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO video_comments (comment_id, video_id, text, likes, published_at, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM video_comments WHERE video_id = ?').run(videoId);
      result.comments.forEach((comment) =>
        insert.run(
          comment.commentId,
          videoId,
          comment.text,
          comment.likes,
          comment.publishedAt.toISOString(),
          time,
        ),
      );
      this.db
        .prepare(
          `INSERT INTO comment_reads (video_id, status, count, read_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (video_id) DO UPDATE SET
             status = excluded.status, count = excluded.count, read_at = excluded.read_at`,
        )
        .run(videoId, result.status, result.comments.length, time);
    })();
  }

  reads(videoIds: readonly string[]): ReadonlyMap<string, CommentRead> {
    if (videoIds.length === 0) return new Map();
    const rows = this.db
      .prepare<string[], ReadRow>(
        `SELECT video_id, status, count, read_at FROM comment_reads WHERE video_id IN (${placeholders(videoIds.length)})`,
      )
      .all(...videoIds);
    return new Map(
      rows.map((row) => [
        row.video_id,
        { status: row.status, count: row.count, readAt: new Date(row.read_at) },
      ]),
    );
  }

  listForVideos(videoIds: readonly string[]): readonly StoredComment[] {
    if (videoIds.length === 0) return [];
    return this.db
      .prepare<string[], CommentRow>(
        `SELECT comment_id, video_id, text, likes, published_at FROM video_comments
         WHERE video_id IN (${placeholders(videoIds.length)}) ORDER BY likes DESC, comment_id`,
      )
      .all(...videoIds)
      .map((row) => ({
        commentId: row.comment_id,
        videoId: row.video_id,
        text: row.text,
        likes: row.likes,
        publishedAt: new Date(row.published_at),
      }));
  }

  findAnswer(centerChannelId: string): ViewerAnswer | null {
    const row = this.db
      .prepare<[string], AnswerRow>(
        'SELECT video_ids_json, findings_json, engine, asked_at FROM comment_answers WHERE center_channel_id = ?',
      )
      .get(centerChannelId);
    if (!row) return null;
    const findings = findingsSchema.safeParse(jsonOf(row.findings_json));
    const videoIds = idsSchema.safeParse(jsonOf(row.video_ids_json));
    if (!findings.success || !videoIds.success) return null;
    return {
      videoIds: videoIds.data,
      findings: findings.data,
      engine: row.engine,
      askedAt: new Date(row.asked_at),
    };
  }

  saveAnswer(centerChannelId: string, answer: ViewerAnswer): void {
    this.db
      .prepare(
        `INSERT INTO comment_answers (center_channel_id, video_ids_json, findings_json, engine, asked_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (center_channel_id) DO UPDATE SET
           video_ids_json = excluded.video_ids_json, findings_json = excluded.findings_json,
           engine = excluded.engine, asked_at = excluded.asked_at`,
      )
      .run(
        centerChannelId,
        JSON.stringify(answer.videoIds),
        JSON.stringify(answer.findings),
        answer.engine,
        answer.askedAt.toISOString(),
      );
  }
}

import type { Db } from '../db/sqlite';
import type { SubjectVideo } from '../report/evidence';
import { fromText } from './rows';
import type { ReportRepo } from './types';

interface Row {
  readonly keyword: string;
  readonly region: string;
  readonly video_id: string;
  readonly published_at: string;
  readonly views_24h: number | null;
  readonly subscribers: number | null;
}

/** What the evidence report reads: one query over what the searches found. */
export class SqliteReportRepo implements ReportRepo {
  constructor(private readonly db: Db) {}

  subjectVideos(): readonly SubjectVideo[] {
    return this.db
      .prepare<[], Row>(
        `SELECT s.keyword, s.region, v.id AS video_id, v.published_at, g.views_24h, c.subscribers
         FROM subjects s
         JOIN (SELECT DISTINCT subject_id, video_id FROM subject_hits) h ON h.subject_id = s.id
         JOIN videos v ON v.id = h.video_id
         JOIN channels c ON c.id = v.channel_id
         LEFT JOIN video_growth g ON g.video_id = v.id
         ORDER BY s.keyword, s.region, v.published_at, v.id`,
      )
      .all()
      .map((row) => ({
        keyword: row.keyword,
        region: row.region,
        videoId: row.video_id,
        publishedAt: fromText(row.published_at),
        views24h: row.views_24h,
        subscribers: row.subscribers,
      }));
  }
}

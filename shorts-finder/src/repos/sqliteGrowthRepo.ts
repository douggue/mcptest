import type { Db } from '../db/sqlite';
import type { GrowthSummary } from '../track/growth';
import { fromTextOrNull, toText } from './rows';
import type { GrowthRepo, StoredGrowth } from './types';

interface GrowthRow {
  readonly views_1h: number | null;
  readonly views_6h: number | null;
  readonly views_24h: number | null;
  readonly views_72h: number | null;
  readonly views_7d: number | null;
  readonly completed_at: string | null;
}

/** Each tracked video's views at five fixed ages: what remains once its readings are gone. */
export class SqliteGrowthRepo implements GrowthRepo {
  constructor(private readonly db: Db) {}

  get(videoId: string): StoredGrowth | null {
    const row = this.db
      .prepare<[string], GrowthRow>('SELECT * FROM video_growth WHERE video_id = ?')
      .get(videoId);
    if (row === undefined) return null;
    return {
      views1h: row.views_1h,
      views6h: row.views_6h,
      views24h: row.views_24h,
      views72h: row.views_72h,
      views7d: row.views_7d,
      completedAt: fromTextOrNull(row.completed_at),
    };
  }

  save(videoId: string, summary: GrowthSummary): void {
    this.write(videoId, summary, null);
  }

  complete(videoId: string, summary: GrowthSummary, at: Date): void {
    this.write(videoId, summary, at);
  }

  private write(videoId: string, summary: GrowthSummary, completedAt: Date | null): void {
    this.db
      .prepare(
        `INSERT INTO video_growth
           (video_id, views_1h, views_6h, views_24h, views_72h, views_7d, completed_at)
         VALUES (@videoId, @views1h, @views6h, @views24h, @views72h, @views7d, @completedAt)
         ON CONFLICT (video_id) DO UPDATE SET
           views_1h = excluded.views_1h, views_6h = excluded.views_6h,
           views_24h = excluded.views_24h, views_72h = excluded.views_72h,
           views_7d = excluded.views_7d,
           completed_at = COALESCE(video_growth.completed_at, excluded.completed_at)`,
      )
      .run({
        videoId,
        ...summary,
        completedAt: completedAt === null ? null : toText(completedAt),
      });
  }
}

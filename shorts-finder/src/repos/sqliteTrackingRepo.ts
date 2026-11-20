import type { Db } from '../db/sqlite';
import { fromText, fromTextOrNull, toText } from './rows';
import type { ShortAnswer, Tier, TrackedVideo, TrackingCounts, TrackingRepo } from './types';

interface TrackingRow {
  readonly video_id: string;
  readonly tier: Tier;
  readonly next_read_at: string | null;
  readonly is_short: ShortAnswer;
  readonly missed_reads: number;
  readonly published_at: string;
}

const toTracked = (row: TrackingRow): TrackedVideo => ({
  videoId: row.video_id,
  tier: row.tier,
  nextReadAt: fromTextOrNull(row.next_read_at),
  isShort: row.is_short,
  missedReads: row.missed_reads,
  publishedAt: fromText(row.published_at),
});

const SELECT_TRACKED = `
  SELECT t.video_id, t.tier, t.next_read_at, t.is_short, t.missed_reads, v.published_at
  FROM video_tracking t JOIN videos v ON v.id = t.video_id`;

/** Which videos are read again, how often, and when next. */
export class SqliteTrackingRepo implements TrackingRepo {
  constructor(private readonly db: Db) {}

  start(videoId: string, isShort: ShortAnswer, nextReadAt: Date): boolean {
    const started = this.db
      .prepare(
        `INSERT INTO video_tracking (video_id, tier, next_read_at, is_short)
         VALUES (?, 'hourly', ?, ?) ON CONFLICT (video_id) DO NOTHING`,
      )
      .run(videoId, toText(nextReadAt), isShort);
    return started.changes === 1;
  }

  listDue(now: Date): readonly TrackedVideo[] {
    return this.db
      .prepare<[string], TrackingRow>(
        `${SELECT_TRACKED} WHERE t.tier <> 'done' AND t.next_read_at <= ?
         ORDER BY t.next_read_at, t.video_id`,
      )
      .all(toText(now))
      .map(toTracked);
  }

  move(videoId: string, tier: Exclude<Tier, 'done'>, nextReadAt: Date): void {
    this.db
      .prepare(
        `UPDATE video_tracking SET tier = ?, next_read_at = ?, missed_reads = 0 WHERE video_id = ?`,
      )
      .run(tier, toText(nextReadAt), videoId);
  }

  markMissed(videoId: string, tier: Exclude<Tier, 'done'>, nextReadAt: Date): number {
    const row = this.db
      .prepare<[string, string, string], { missed_reads: number }>(
        `UPDATE video_tracking SET tier = ?, next_read_at = ?, missed_reads = missed_reads + 1
         WHERE video_id = ? RETURNING missed_reads`,
      )
      .get(tier, toText(nextReadAt), videoId);
    return row?.missed_reads ?? 0;
  }

  classify(videoId: string, isShort: ShortAnswer): void {
    this.db
      .prepare('UPDATE video_tracking SET is_short = ? WHERE video_id = ?')
      .run(isShort, videoId);
  }

  finish(videoId: string): void {
    this.db
      .prepare(`UPDATE video_tracking SET tier = 'done', next_read_at = NULL WHERE video_id = ?`)
      .run(videoId);
  }

  get(videoId: string): TrackedVideo | null {
    const row = this.db
      .prepare<[string], TrackingRow>(`${SELECT_TRACKED} WHERE t.video_id = ?`)
      .get(videoId);
    return row === undefined ? null : toTracked(row);
  }

  counts(now: Date): TrackingCounts {
    const row = this.db
      .prepare<[string], { tracked: number; due: number | null }>(
        `SELECT COUNT(*) AS tracked, SUM(next_read_at <= ?) AS due
         FROM video_tracking WHERE tier <> 'done'`,
      )
      .get(toText(now));
    return { tracked: row?.tracked ?? 0, due: row?.due ?? 0 };
  }
}

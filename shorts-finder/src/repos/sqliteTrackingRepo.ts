import type { Db } from '../db/sqlite';
import { fromText, fromTextOrNull, toText } from './rows';
import type {
  ActiveVideo,
  FinishReason,
  MissedRead,
  ShortAnswer,
  Standing,
  Tier,
  TrackedVideo,
  TrackingCounts,
  TrackingRepo,
} from './types';

interface TrackingRow {
  readonly video_id: string;
  readonly tier: Tier;
  readonly next_read_at: string | null;
  readonly is_short: ShortAnswer;
  readonly missed_reads: number;
  readonly published_at: string;
  readonly finished_at: string | null;
  readonly finish_reason: FinishReason | null;
  readonly low_streak: number;
  readonly rate: number | null;
}

interface ActiveRow extends TrackingRow {
  readonly channel_id: string;
  readonly views: number | null;
  readonly keyword: string | null;
  readonly region: string | null;
  readonly subscribers: number | null;
}

const toTracked = (row: TrackingRow): TrackedVideo => ({
  videoId: row.video_id,
  tier: row.tier,
  nextReadAt: fromTextOrNull(row.next_read_at),
  isShort: row.is_short,
  missedReads: row.missed_reads,
  publishedAt: fromText(row.published_at),
  finishedAt: fromTextOrNull(row.finished_at),
  finishReason: row.finish_reason,
  lowStreak: row.low_streak,
  rate: row.rate,
});

const toActive = (row: ActiveRow): ActiveVideo => ({
  ...toTracked(row),
  channelId: row.channel_id,
  views: row.views,
  keyword: row.keyword,
  region: row.region,
  subscribers: row.subscribers,
});

const TRACKED_COLUMNS = `t.video_id, t.tier, t.next_read_at, t.is_short, t.missed_reads,
    v.published_at, t.finished_at, t.finish_reason, t.low_streak, t.rate`;

const SELECT_TRACKED = `
  SELECT ${TRACKED_COLUMNS}
  FROM video_tracking t JOIN videos v ON v.id = t.video_id`;

/**
 * A tracked video with what places it in a group: its channel's size, and the
 * subject of the first search that found it. A video found on a followed
 * channel carries the subject that first led to the channel, noted on its hit.
 */
const SELECT_ACTIVE = `
  SELECT ${TRACKED_COLUMNS}, v.channel_id, v.views, s.keyword, s.region, c.subscribers
  FROM video_tracking t
  JOIN videos v ON v.id = t.video_id
  JOIN channels c ON c.id = v.channel_id
  LEFT JOIN subjects s ON s.id = (
    SELECT h.subject_id FROM subject_hits h
    WHERE h.video_id = t.video_id AND h.subject_id IS NOT NULL
    ORDER BY h.first_seen_at, h.subject_id LIMIT 1)
  WHERE t.tier <> 'done'
  ORDER BY t.next_read_at, t.video_id`;

/** Which videos are read again, how often, and when next. */
export class SqliteTrackingRepo implements TrackingRepo {
  constructor(private readonly db: Db) {}

  start(
    videoId: string,
    isShort: ShortAnswer,
    nextReadAt: Date,
    tier: Exclude<Tier, 'done'> = 'hourly',
  ): boolean {
    const started = this.db
      .prepare(
        `INSERT INTO video_tracking (video_id, tier, next_read_at, is_short)
         VALUES (?, ?, ?, ?) ON CONFLICT (video_id) DO NOTHING`,
      )
      .run(videoId, tier, toText(nextReadAt), isShort);
    return started.changes === 1;
  }

  listDue(before: Date): readonly TrackedVideo[] {
    return this.db
      .prepare<[string], TrackingRow>(
        `${SELECT_TRACKED} WHERE t.tier <> 'done' AND t.next_read_at <= ?
         ORDER BY t.next_read_at, t.video_id`,
      )
      .all(toText(before))
      .map(toTracked);
  }

  listActive(): readonly ActiveVideo[] {
    return this.db.prepare<[], ActiveRow>(SELECT_ACTIVE).all().map(toActive);
  }

  listPublishedBefore(moment: Date): readonly string[] {
    return this.db
      .prepare<[string], { video_id: string }>(
        `SELECT t.video_id FROM video_tracking t JOIN videos v ON v.id = t.video_id
         WHERE t.tier <> 'done' AND v.published_at < ? ORDER BY t.video_id`,
      )
      .all(toText(moment))
      .map((row) => row.video_id);
  }

  move(videoId: string, tier: Exclude<Tier, 'done'>, nextReadAt: Date, standing?: Standing): void {
    this.db
      .prepare(
        `UPDATE video_tracking SET tier = @tier, next_read_at = @nextReadAt, missed_reads = 0,
           last_missed_at = NULL,
           low_streak = COALESCE(@lowStreak, low_streak),
           rate = CASE WHEN @rateAt IS NULL THEN rate ELSE @rate END,
           rate_at = COALESCE(@rateAt, rate_at)
         WHERE video_id = @videoId`,
      )
      .run({
        videoId,
        tier,
        nextReadAt: toText(nextReadAt),
        lowStreak: standing?.lowStreak ?? null,
        rate: standing?.rate ?? null,
        rateAt: standing === undefined ? null : toText(standing.rateAt),
      });
  }

  setRate(videoId: string, rate: number | null, at: Date): void {
    this.db
      .prepare('UPDATE video_tracking SET rate = ?, rate_at = ? WHERE video_id = ?')
      .run(rate, toText(at), videoId);
  }

  markMissed(miss: MissedRead): number {
    const before = this.db
      .prepare<[string], { missed_reads: number; last_missed_at: string | null }>(
        'SELECT missed_reads, last_missed_at FROM video_tracking WHERE video_id = ?',
      )
      .get(miss.videoId);
    if (before === undefined) return 0;
    const last = fromTextOrNull(before.last_missed_at);
    const gap = last === null ? null : miss.at.getTime() - last.getTime();
    const counts = gap === null || gap >= miss.minGapMs;
    // A last miss "after now" (the clock was set back) is forgotten, uncounted,
    // so the clock cannot hold the count still for ever.
    const restamp = counts || (gap !== null && gap < 0);
    this.db
      .prepare(
        `UPDATE video_tracking SET tier = @tier, next_read_at = @nextReadAt,
           missed_reads = @missed, last_missed_at = @lastMissedAt WHERE video_id = @videoId`,
      )
      .run({
        videoId: miss.videoId,
        tier: miss.tier,
        nextReadAt: toText(miss.nextReadAt),
        missed: before.missed_reads + (counts ? 1 : 0),
        lastMissedAt: restamp ? toText(miss.at) : before.last_missed_at,
      });
    return before.missed_reads + (counts ? 1 : 0);
  }

  classify(videoId: string, isShort: ShortAnswer): void {
    this.db
      .prepare('UPDATE video_tracking SET is_short = ? WHERE video_id = ?')
      .run(isShort, videoId);
  }

  finish(videoId: string, reason: FinishReason, at: Date): void {
    this.db
      .prepare(
        `UPDATE video_tracking SET tier = 'done', next_read_at = NULL,
           finished_at = COALESCE(finished_at, ?), finish_reason = COALESCE(finish_reason, ?)
         WHERE video_id = ?`,
      )
      .run(toText(at), reason, videoId);
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

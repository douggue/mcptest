import { z } from 'zod';
import type { Db } from '../db/sqlite';
import { reasonFromText, reasonToText } from '../findings/reason';
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from '../youtube/ids';
import { fromText, fromTextOrNull, toText } from './rows';
import type { Finding, FindingKind, FindingRepo, NewFinding } from './types';

const MAX_TITLE_LENGTH = 500;

const figure = z.number().nonnegative().nullable();

/** What is checked before a finding is stored; the reason has its own check. */
const findingSchema = z.object({
  videoId: z.string().regex(VIDEO_ID_PATTERN, 'must be a YouTube video id'),
  channelId: z.string().regex(CHANNEL_ID_PATTERN, 'must be a YouTube channel id'),
  videoTitle: z.string().max(MAX_TITLE_LENGTH),
  channelTitle: z.string().max(MAX_TITLE_LENGTH).nullable(),
  kind: z.enum(['niche', 'transfer']),
  viewsPerHour: figure,
  earningsLow: figure,
  earningsHigh: figure,
});

interface FindingRow {
  readonly id: number;
  readonly video_id: string;
  readonly channel_id: string;
  readonly video_title: string;
  readonly channel_title: string | null;
  readonly published_at: string;
  readonly kind: FindingKind;
  readonly reason: string;
  readonly views_per_hour: number | null;
  readonly earnings_low: number | null;
  readonly earnings_high: number | null;
  readonly found_at: string;
  readonly alerted_at: string | null;
  readonly digested_at: string | null;
}

const toFinding = (row: FindingRow): Finding => ({
  id: row.id,
  videoId: row.video_id,
  channelId: row.channel_id,
  videoTitle: row.video_title,
  channelTitle: row.channel_title,
  publishedAt: fromText(row.published_at),
  kind: row.kind,
  reason: reasonFromText(row.reason),
  viewsPerHour: row.views_per_hour,
  earningsLow: row.earnings_low,
  earningsHigh: row.earnings_high,
  foundAt: fromText(row.found_at),
  alertedAt: fromTextOrNull(row.alerted_at),
  digestedAt: fromTextOrNull(row.digested_at),
});

function requireValid(finding: NewFinding): void {
  const parsed = findingSchema.safeParse(finding);
  if (parsed.success) return;
  const problems = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid finding. ${problems}`);
}

/** What was found, and whether the owner has been told. */
export class SqliteFindingRepo implements FindingRepo {
  constructor(private readonly db: Db) {}

  add(finding: NewFinding): boolean {
    requireValid(finding);
    const added = this.db
      .prepare(
        `INSERT INTO findings (video_id, channel_id, video_title, channel_title, published_at,
           kind, reason, views_per_hour, earnings_low, earnings_high, found_at)
         VALUES (@videoId, @channelId, @videoTitle, @channelTitle, @publishedAt,
           @kind, @reason, @viewsPerHour, @earningsLow, @earningsHigh, @foundAt)
         ON CONFLICT (video_id, kind) DO NOTHING`,
      )
      .run({
        videoId: finding.videoId,
        channelId: finding.channelId,
        videoTitle: finding.videoTitle,
        channelTitle: finding.channelTitle,
        publishedAt: toText(finding.publishedAt),
        kind: finding.kind,
        reason: reasonToText(finding.reason),
        viewsPerHour: finding.viewsPerHour,
        earningsLow: finding.earningsLow,
        earningsHigh: finding.earningsHigh,
        foundAt: toText(finding.foundAt),
      });
    return added.changes === 1;
  }

  listWaiting(limit: number): readonly Finding[] {
    return this.db
      .prepare<[number], FindingRow>(
        `SELECT * FROM findings WHERE alerted_at IS NULL AND digested_at IS NULL
         ORDER BY found_at, id LIMIT ?`,
      )
      .all(Math.max(0, Math.floor(limit)))
      .map(toFinding);
  }

  countWaiting(): number {
    const row = this.db
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) AS n FROM findings WHERE alerted_at IS NULL AND digested_at IS NULL`,
      )
      .get();
    return row?.n ?? 0;
  }

  markAlerted(id: number, at: Date): boolean {
    const marked = this.db
      .prepare(`UPDATE findings SET alerted_at = ? WHERE id = ? AND alerted_at IS NULL`)
      .run(toText(at), id);
    return marked.changes === 1;
  }

  markDigested(ids: readonly number[], at: Date): void {
    const mark = this.db.prepare(
      `UPDATE findings SET digested_at = ? WHERE id = ? AND digested_at IS NULL`,
    );
    this.db.transaction(() => {
      ids.forEach((id) => mark.run(toText(at), id));
    })();
  }

  countAlertedBetween(from: Date, to: Date): number {
    const row = this.db
      .prepare<[string, string], { n: number }>(
        `SELECT COUNT(*) AS n FROM findings WHERE alerted_at >= ? AND alerted_at < ?`,
      )
      .get(toText(from), toText(to));
    return row?.n ?? 0;
  }

  listFoundBetween(from: Date, to: Date): readonly Finding[] {
    return this.db
      .prepare<[string, string], FindingRow>(
        `SELECT * FROM findings WHERE found_at >= ? AND found_at < ? ORDER BY found_at, id`,
      )
      .all(toText(from), toText(to))
      .map(toFinding);
  }
}

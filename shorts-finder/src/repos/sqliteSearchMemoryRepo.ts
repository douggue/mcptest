import type { Db } from '../db/sqlite';
import { fromText, toText } from './rows';
import type {
  PassedOverReason,
  PassedOverRepo,
  PendingHit,
  PendingHitRepo,
  SearchKind,
} from './types';

interface PendingRow {
  readonly subject_id: number;
  readonly video_id: string;
  readonly kind: SearchKind;
  readonly rank: number | null;
  readonly channel_id: string;
  readonly channel_title: string | null;
  readonly found_at: string;
}

const toPending = (row: PendingRow): PendingHit => ({
  subjectId: row.subject_id,
  videoId: row.video_id,
  kind: row.kind,
  rank: row.rank,
  channelId: row.channel_id,
  channelTitle: row.channel_title,
  foundAt: fromText(row.found_at),
});

/**
 * What a search returned, kept from the moment the search answers until the
 * details of its videos have been read. A search is the dear part of the
 * day; its results must outlive a failed details request or a restart.
 */
export class SqlitePendingHitRepo implements PendingHitRepo {
  constructor(private readonly db: Db) {}

  add(hit: PendingHit): boolean {
    const added = this.db
      .prepare(
        `INSERT INTO pending_hits
           (subject_id, video_id, kind, rank, channel_id, channel_title, found_at)
         VALUES (@subjectId, @videoId, @kind, @rank, @channelId, @channelTitle, @foundAt)
         ON CONFLICT (subject_id, video_id, kind) DO NOTHING`,
      )
      .run({ ...hit, foundAt: toText(hit.foundAt) });
    return added.changes === 1;
  }

  list(): readonly PendingHit[] {
    return this.db
      .prepare<[], PendingRow>(
        'SELECT * FROM pending_hits ORDER BY found_at, subject_id, video_id, kind',
      )
      .all()
      .map(toPending);
  }

  remove(hit: Pick<PendingHit, 'subjectId' | 'videoId' | 'kind'>): void {
    this.db
      .prepare('DELETE FROM pending_hits WHERE subject_id = ? AND video_id = ? AND kind = ?')
      .run(hit.subjectId, hit.videoId, hit.kind);
  }

  count(): number {
    const row = this.db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM pending_hits').get();
    return row?.n ?? 0;
  }

  deleteOlderThan(cutoff: Date): number {
    return this.db.prepare('DELETE FROM pending_hits WHERE found_at < ?').run(toText(cutoff))
      .changes;
  }
}

/**
 * Videos a search returned that will not be tracked: too long for a Short, or
 * not returned when their details were asked for. Remembered so that later
 * searches, which return them again, do not pay to read them again.
 */
export class SqlitePassedOverRepo implements PassedOverRepo {
  constructor(private readonly db: Db) {}

  add(videoId: string, reason: PassedOverReason, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO passed_over_videos (video_id, reason, noted_at) VALUES (?, ?, ?)
         ON CONFLICT (video_id) DO NOTHING`,
      )
      .run(videoId, reason, toText(at));
  }

  knownIds(ids: readonly string[]): readonly string[] {
    if (ids.length === 0) return [];
    return this.db
      .prepare<[string], { video_id: string }>(
        `SELECT video_id FROM passed_over_videos
         WHERE video_id IN (SELECT value FROM json_each(?)) ORDER BY video_id`,
      )
      .all(JSON.stringify(ids))
      .map((row) => row.video_id);
  }

  deleteOlderThan(cutoff: Date): number {
    return this.db.prepare('DELETE FROM passed_over_videos WHERE noted_at < ?').run(toText(cutoff))
      .changes;
  }
}

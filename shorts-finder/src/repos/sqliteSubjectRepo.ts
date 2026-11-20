import type { Db } from '../db/sqlite';
import type { NewSubject } from '../subjects/subject';
import { fromText, fromTextOrNull, toText } from './rows';
import type {
  HitKind,
  SearchKind,
  Subject,
  SubjectHit,
  SubjectHitRepo,
  SubjectRepo,
  Sweep,
} from './types';

/** How "no language in particular" is stored: the column takes part in a uniqueness rule, where NULLs would all count as different. */
const NO_LANGUAGE = '';

interface SubjectRow {
  readonly id: number;
  readonly keyword: string;
  readonly region: string;
  readonly language: string;
  readonly every_hours: number;
  readonly enabled: number;
  readonly last_searched_at: string | null;
  readonly newest_every_hours: number;
  readonly newest_interval_hours: number | null;
  readonly newest_last_at: string | null;
  readonly newest_swept_to: string | null;
}

const toSubject = (row: SubjectRow): Subject => ({
  id: row.id,
  keyword: row.keyword,
  region: row.region,
  language: row.language === NO_LANGUAGE ? null : row.language,
  everyHours: row.every_hours,
  newestEveryHours: row.newest_every_hours,
  enabled: row.enabled === 1,
  lastSearchedAt: fromTextOrNull(row.last_searched_at),
  // Never above the configured cadence, also after the owner shortens that.
  newestIntervalHours: Math.min(
    row.newest_every_hours,
    row.newest_interval_hours ?? row.newest_every_hours,
  ),
  newestLastAt: fromTextOrNull(row.newest_last_at),
  newestSweptTo: fromTextOrNull(row.newest_swept_to),
});

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Error && /UNIQUE constraint failed/.test(error.message);

/** The owner's list of subjects to search for. */
export class SqliteSubjectRepo implements SubjectRepo {
  constructor(private readonly db: Db) {}

  add(subject: NewSubject): Subject {
    try {
      const row = this.db
        .prepare<[string, string, string, number, number], SubjectRow>(
          `INSERT INTO subjects (keyword, region, language, every_hours, newest_every_hours, enabled)
           VALUES (?, ?, ?, ?, ?, 1) RETURNING *`,
        )
        .get(
          subject.keyword,
          subject.region,
          subject.language ?? NO_LANGUAGE,
          subject.everyHours,
          subject.newestEveryHours,
        );
      return toSubject(row as SubjectRow);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw new Error(
        `The subject "${subject.keyword}" in ${subject.region} is already on the list`,
        { cause: error },
      );
    }
  }

  list(): readonly Subject[] {
    return this.db
      .prepare<[], SubjectRow>('SELECT * FROM subjects ORDER BY id')
      .all()
      .map(toSubject);
  }

  setEnabled(id: number, enabled: boolean): boolean {
    const changed = this.db
      .prepare('UPDATE subjects SET enabled = ? WHERE id = ?')
      .run(enabled ? 1 : 0, id);
    return changed.changes === 1;
  }

  markSearched(id: number, kind: SearchKind, at: Date): void {
    // The column is one of two written here, never a value from outside.
    const column = kind === 'top_recent' ? 'last_searched_at' : 'newest_last_at';
    this.db.prepare(`UPDATE subjects SET ${column} = ? WHERE id = ?`).run(toText(at), id);
  }

  markSwept(id: number, sweep: Sweep): void {
    this.db
      .prepare(
        `UPDATE subjects SET newest_last_at = @at, newest_swept_to = @at,
           newest_interval_hours = @intervalHours WHERE id = @id`,
      )
      .run({ id, at: toText(sweep.at), intervalHours: sweep.intervalHours });
  }
}

interface HitRow {
  readonly subject_id: number | null;
  readonly video_id: string;
  readonly kind: HitKind;
  readonly rank: number | null;
  readonly age_hours: number | null;
  readonly first_seen_at: string;
}

/** Which search, or which channel read, found which video, noted the first time only. */
export class SqliteSubjectHitRepo implements SubjectHitRepo {
  constructor(private readonly db: Db) {}

  add(hit: SubjectHit): boolean {
    const added = this.db
      .prepare(
        `INSERT INTO subject_hits (subject_id, video_id, kind, rank, age_hours, first_seen_at)
         VALUES (@subjectId, @videoId, @kind, @rank, @ageHours, @firstSeenAt)
         ON CONFLICT DO NOTHING`,
      )
      .run({ ...hit, firstSeenAt: toText(hit.firstSeenAt) });
    return added.changes === 1;
  }

  videoIdsFor(subjectId: number): readonly string[] {
    return this.db
      .prepare<[number], { video_id: string }>(
        `SELECT video_id FROM subject_hits WHERE subject_id = ?
         GROUP BY video_id ORDER BY MIN(first_seen_at), video_id`,
      )
      .all(subjectId)
      .map((row) => row.video_id);
  }

  listForVideo(videoId: string): readonly SubjectHit[] {
    return this.db
      .prepare<[string], HitRow>(
        `SELECT * FROM subject_hits WHERE video_id = ? ORDER BY first_seen_at, kind`,
      )
      .all(videoId)
      .map((row) => ({
        subjectId: row.subject_id,
        videoId: row.video_id,
        kind: row.kind,
        rank: row.rank,
        ageHours: row.age_hours,
        firstSeenAt: fromText(row.first_seen_at),
      }));
  }

  firstSubjectForChannel(channelId: string): number | null {
    const row = this.db
      .prepare<[string], { subject_id: number }>(
        `SELECT h.subject_id FROM subject_hits h JOIN videos v ON v.id = h.video_id
         WHERE v.channel_id = ? AND h.subject_id IS NOT NULL
         ORDER BY h.first_seen_at, h.subject_id LIMIT 1`,
      )
      .get(channelId);
    return row?.subject_id ?? null;
  }
}

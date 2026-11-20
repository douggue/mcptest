import type { Db } from '../db/sqlite';
import type { NewSubject } from '../subjects/subject';
import { fromTextOrNull, toText } from './rows';
import type { Subject, SubjectHitRepo, SubjectRepo } from './types';

/** How "no language in particular" is stored: the column takes part in a uniqueness rule, where NULLs would all count as different. */
const NO_LANGUAGE = '';
const SECONDS_PER_HOUR = 3600;

interface SubjectRow {
  readonly id: number;
  readonly keyword: string;
  readonly region: string;
  readonly language: string;
  readonly every_hours: number;
  readonly enabled: number;
  readonly last_searched_at: string | null;
}

const toSubject = (row: SubjectRow): Subject => ({
  id: row.id,
  keyword: row.keyword,
  region: row.region,
  language: row.language === NO_LANGUAGE ? null : row.language,
  everyHours: row.every_hours,
  enabled: row.enabled === 1,
  lastSearchedAt: fromTextOrNull(row.last_searched_at),
});

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Error && /UNIQUE constraint failed/.test(error.message);

/** The owner's list of subjects to search for. */
export class SqliteSubjectRepo implements SubjectRepo {
  constructor(private readonly db: Db) {}

  add(subject: NewSubject): Subject {
    try {
      const row = this.db
        .prepare<[string, string, string, number], SubjectRow>(
          `INSERT INTO subjects (keyword, region, language, every_hours, enabled)
           VALUES (?, ?, ?, ?, 1) RETURNING *`,
        )
        .get(subject.keyword, subject.region, subject.language ?? NO_LANGUAGE, subject.everyHours);
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

  markSearched(id: number, at: Date): void {
    this.db.prepare('UPDATE subjects SET last_searched_at = ? WHERE id = ?').run(toText(at), id);
  }

  listDue(now: Date): readonly Subject[] {
    // Whole seconds, so a subject searched exactly its hours ago is due. One
    // searched "after now" (the clock was set back since) is due as well.
    return this.db
      .prepare<{ now: string; hour: number }, SubjectRow>(
        `SELECT * FROM subjects
         WHERE enabled = 1 AND (last_searched_at IS NULL
           OR strftime('%s', @now) - strftime('%s', last_searched_at) >= every_hours * @hour
           OR last_searched_at > @now)
         ORDER BY last_searched_at IS NOT NULL, last_searched_at, id`,
      )
      .all({ now: toText(now), hour: SECONDS_PER_HOUR })
      .map(toSubject);
  }
}

/** Which search found which video, noted the first time only. */
export class SqliteSubjectHitRepo implements SubjectHitRepo {
  constructor(private readonly db: Db) {}

  add(subjectId: number, videoId: string, firstSeenAt: Date): boolean {
    const added = this.db
      .prepare(
        `INSERT INTO subject_hits (subject_id, video_id, first_seen_at) VALUES (?, ?, ?)
         ON CONFLICT (subject_id, video_id) DO NOTHING`,
      )
      .run(subjectId, videoId, toText(firstSeenAt));
    return added.changes === 1;
  }

  videoIdsFor(subjectId: number): readonly string[] {
    return this.db
      .prepare<[number], { video_id: string }>(
        `SELECT video_id FROM subject_hits WHERE subject_id = ? ORDER BY first_seen_at, video_id`,
      )
      .all(subjectId)
      .map((row) => row.video_id);
  }
}

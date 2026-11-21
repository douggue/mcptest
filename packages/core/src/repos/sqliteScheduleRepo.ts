import type { ConceptStatus } from '../calendar/calendar';
import type { ScheduleEntry, ScheduleRepo } from '../calendar/store';
import type { Db } from '../db/sqlite';

interface EntryRow {
  concept_id: number;
  status: ConceptStatus | null;
  planned_date: string | null;
}

export class SqliteScheduleRepo implements ScheduleRepo {
  constructor(private readonly db: Db) {}

  list(centerChannelId: string): ReadonlyMap<number, ScheduleEntry> {
    const rows = this.db
      .prepare<[string], EntryRow>(
        'SELECT concept_id, status, planned_date FROM concept_schedule WHERE center_channel_id = ?',
      )
      .all(centerChannelId);
    return new Map(
      rows.map((row) => [row.concept_id, { status: row.status, plannedDate: row.planned_date }]),
    );
  }

  save(centerChannelId: string, conceptId: number, entry: ScheduleEntry, at: Date): void {
    this.db
      .prepare(
        `INSERT INTO concept_schedule (concept_id, center_channel_id, status, planned_date, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (concept_id) DO UPDATE SET
           status = excluded.status, planned_date = excluded.planned_date,
           updated_at = excluded.updated_at`,
      )
      .run(conceptId, centerChannelId, entry.status, entry.plannedDate, at.toISOString());
  }
}

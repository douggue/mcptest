import type { ConceptStatus } from './calendar';

/** What the owner set for one kept concept in the calendar. */
export interface ScheduleEntry {
  /** Null when the status comes from elsewhere: the script, or a linked video. */
  readonly status: ConceptStatus | null;
  /** YYYY-MM-DD; null when no date is planned. */
  readonly plannedDate: string | null;
}

export interface ScheduleRepo {
  /** The channel's entries by concept id. */
  list(centerChannelId: string): ReadonlyMap<number, ScheduleEntry>;
  save(centerChannelId: string, conceptId: number, entry: ScheduleEntry, at: Date): void;
}

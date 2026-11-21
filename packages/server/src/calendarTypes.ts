/** The upload calendar as the API sees it: one centre channel's kept concepts by week. */
import type { CalendarView, ScheduleEntry } from '@jgtube/core';

export type CalendarOutcome = 'saved' | 'no-concept' | 'bad-date' | 'no-map';

export interface CalendarReply {
  readonly outcome: CalendarOutcome;
  /** The calendar after a save; null when nothing was saved. */
  readonly calendar: CalendarView | null;
}

export interface CalendarEngine {
  /** Reads the store only; null when the channel has no map. */
  findCalendar(centerChannelId: string): CalendarView | null;
  saveCalendarItem(centerChannelId: string, conceptId: number, entry: ScheduleEntry): CalendarReply;
}

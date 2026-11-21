/**
 * The upload calendar for one centre channel. Weeks are counted from the
 * date on this computer, where the owner is; it reads and writes the store only.
 */
import { loadCalendar, saveSchedule, type CalendarDeps } from '@jgtube/core';
import type { CalendarEngine } from './calendarTypes';

export interface CalendarEngineDeps {
  readonly now: () => Date;
  readonly repos: CalendarDeps;
}

const twoDigits = (value: number): string => String(value).padStart(2, '0');

/** The computer's own calendar date, YYYY-MM-DD. */
export function localDate(at: Date): string {
  return `${at.getFullYear()}-${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())}`;
}

export function calendarEngine({ now, repos }: CalendarEngineDeps): CalendarEngine {
  const read = (center: string) => {
    const at = now();
    return loadCalendar(repos, center, at, localDate(at));
  };

  return {
    findCalendar: read,

    saveCalendarItem(center, conceptId, entry) {
      if (repos.maps.latestForCenter(center) === null) return { outcome: 'no-map', calendar: null };
      const outcome = saveSchedule(repos, center, conceptId, entry, now());
      return { outcome, calendar: outcome === 'saved' ? read(center) : null };
    },
  };
}

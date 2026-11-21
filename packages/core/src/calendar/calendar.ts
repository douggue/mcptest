/**
 * The upload calendar of one centre channel: its kept concepts by the week
 * they are planned for, from this week on. A week is called a gap when fewer
 * videos are planned in it than the look-alike winners' median a week. Dates
 * are calendar dates written YYYY-MM-DD; weeks start on Monday.
 */

/** Weeks always shown from this one, and the most shown when plans reach further. */
export const CALENDAR_MIN_WEEKS = 8;
export const CALENDAR_MAX_WEEKS = 26;

export const CONCEPT_STATUSES = ['idea', 'drafting', 'ready', 'published'] as const;
export type ConceptStatus = (typeof CONCEPT_STATUSES)[number];

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CalendarItem {
  readonly conceptId: number;
  readonly title: string;
  /** The status shown: worked out from a linked video, what the owner set, or the script. */
  readonly status: ConceptStatus;
  /** The status the owner set in the calendar; null when it is worked out. Sent back with a date. */
  readonly setStatus: ConceptStatus | null;
  readonly plannedDate: string | null;
  readonly hasScript: boolean;
  /** The video linked to the concept in "your videos against the plan"; null when none. */
  readonly linkedVideoId: string | null;
}

export interface CalendarWeek {
  /** Its Monday. */
  readonly start: string;
  readonly items: readonly CalendarItem[];
  readonly planned: number;
  /** Fewer planned than the winners' median a week; false with no median. */
  readonly gap: boolean;
}

const toTime = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number): string => new Date(time).toISOString().slice(0, 10);

/** Whether the text is a real date written YYYY-MM-DD. */
export function isPlannedDate(text: string): boolean {
  return DATE.test(text) && !Number.isNaN(toTime(text)) && toDate(toTime(text)) === text;
}

/** The Monday of the week a date falls in. */
export function weekStart(date: string): string {
  const time = toTime(date);
  const sinceMonday = (new Date(time).getUTCDay() + 6) % 7;
  return toDate(time - sinceMonday * DAY_MS);
}

const addWeeks = (monday: string, weeks: number): string =>
  toDate(toTime(monday) + weeks * 7 * DAY_MS);

export interface CalendarWeeks {
  readonly weeks: readonly CalendarWeek[];
  readonly undated: readonly CalendarItem[];
  /** Planned before this week, and past the last week shown. */
  readonly earlier: readonly CalendarItem[];
  readonly later: readonly CalendarItem[];
}

/** The items laid out by week from the week of `today`. */
export function buildWeeks(
  items: readonly CalendarItem[],
  today: string,
  pace: number | null,
): CalendarWeeks {
  const first = weekStart(today);
  const dated = items.filter((item) => item.plannedDate !== null);
  const limit = addWeeks(first, CALENDAR_MAX_WEEKS);
  const lastPlanned = dated.reduce((last, item) => {
    const monday = weekStart(item.plannedDate ?? today);
    return monday > last && monday < limit ? monday : last;
  }, first);
  const span = Math.round((toTime(lastPlanned) - toTime(first)) / (7 * DAY_MS)) + 1;
  const count = Math.min(CALENDAR_MAX_WEEKS, Math.max(CALENDAR_MIN_WEEKS, span));
  const weeks = Array.from({ length: count }, (_, index): CalendarWeek => {
    const start = addWeeks(first, index);
    const inWeek = dated.filter((item) => weekStart(item.plannedDate ?? '') === start);
    return {
      start,
      items: inWeek,
      planned: inWeek.length,
      gap: pace !== null && inWeek.length < pace,
    };
  });
  const end = addWeeks(first, count);
  return {
    weeks,
    undated: items.filter((item) => item.plannedDate === null),
    earlier: dated.filter((item) => (item.plannedDate ?? '') < first),
    later: dated.filter((item) => (item.plannedDate ?? '') >= end),
  };
}

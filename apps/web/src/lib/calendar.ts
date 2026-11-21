import type { CalendarView, CalendarWeek, ConceptStatus } from '@jgtube/core';

/** The statuses in order. Kept here: the page takes only types from core, which runs in Node. */
export const STATUSES: readonly ConceptStatus[] = ['idea', 'drafting', 'ready', 'published'];

export const STATUS_LABELS: Readonly<Record<ConceptStatus, string>> = {
  idea: 'Idea',
  drafting: 'Drafting',
  ready: 'Ready',
  published: 'Published',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 23 Nov" for a YYYY-MM-DD Monday. */
function mondayText(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `Mon ${day ?? ''} ${MONTHS[(month ?? 1) - 1] ?? ''}`;
}

/** A week by its Monday; the week holding today is called this week. */
export function weekLabel(start: string, today: string): string {
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return today >= start && today < end
    ? `This week (from ${mondayText(start)})`
    : `Week of ${mondayText(start)}`;
}

/** A rate in at most one decimal: "2.5", "1". */
const rate = (value: number): string => String(Math.round(value * 10) / 10);

/** The look-alike winners' pace, with how many channels it rests on and over how long. */
export function paceLine(pace: CalendarView['pace']): string {
  const { channels, medianPerWeek, windowDays } = pace;
  if (medianPerWeek === null || channels === 0) {
    return 'No channel like yours has taken off on this map, so there is no pace to compare with.';
  }
  const who =
    channels === 1
      ? 'The 1 channel like yours that took off on this map uploads'
      : `The ${channels} channels like yours that took off on this map upload a median of`;
  const videos = `${rate(medianPerWeek)} video${medianPerWeek === 1 ? '' : 's'} a week`;
  return `${who} ${videos} (counted over the last ${windowDays} days). A comparison, not a target.`;
}

/** What a week holds, and whether it is under the winners' pace. */
export function weekNote(week: CalendarWeek, pace: CalendarView['pace']): string {
  const planned = week.planned === 0 ? 'Nothing planned' : `${week.planned} planned`;
  return week.gap && pace.medianPerWeek !== null
    ? `${planned} · fewer than the winners’ ${rate(pace.medianPerWeek)} a week`
    : planned;
}

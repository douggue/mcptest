/**
 * When the schedule's next sweep is due. Pure, from the owner's settings and
 * the last sweep as stored.
 */
import { SWEEP_DAY_HOURS, SWEEP_REFUSAL_REST_HOURS } from './budget';
import type { SweepSettings, StoredSweep } from './types';

const HOUR_MS = 60 * 60 * 1000;
const DAY_HOURS = 24;

/** Until when nothing is swept because YouTube refused the last sweep; null when not resting. */
export function refusalRestUntil(last: StoredSweep | null, now: Date): Date | null {
  if (last === null || last.stopped !== 'refused') return null;
  const from = last.finishedAt ?? last.startedAt;
  const until = new Date(from.getTime() + SWEEP_REFUSAL_REST_HOURS * HOUR_MS);
  return until.getTime() > now.getTime() ? until : null;
}

/** A sweep that did not get through the watchlist: it stopped at the budget or was cut off. */
const unfinished = (last: StoredSweep): boolean =>
  last.stopped === 'budget' || last.stopped === null;

/**
 * Whether the schedule should start a sweep now. A day's turn comes after
 * twenty hours; every N days is N − 1 days and twenty hours. A sweep that
 * stopped at the budget resumes the next day whatever N is.
 */
export function sweepDue(settings: SweepSettings, last: StoredSweep | null, now: Date): boolean {
  if (settings.everyDays === null) return false;
  if (last === null) return true;
  if (last.stopped === 'refused') return refusalRestUntil(last, now) === null;
  const days = unfinished(last) ? 1 : settings.everyDays;
  const waitHours = (days - 1) * DAY_HOURS + SWEEP_DAY_HOURS;
  return now.getTime() - last.startedAt.getTime() >= waitHours * HOUR_MS;
}

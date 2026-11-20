/**
 * How often a tracked video is read, by its age. A Short gains most of its
 * views in its first days, so that is where the readings go; the allowance
 * for readings (2,000 units a day, fifty videos a unit) is what sets the rest.
 */
import type { Tier } from '../repos/types';

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export const HOURLY_READ_MS = MS_PER_HOUR;
export const SIX_HOURLY_READ_MS = 6 * MS_PER_HOUR;
/**
 * Read every hour for the first 72 hours after publication: the days in which
 * a Short is offered to new viewers fastest, and in which an hour's gain says
 * the most about where it is heading.
 */
export const HOURLY_UNTIL_MS = 72 * MS_PER_HOUR;
/**
 * Then every six hours until day 14: four readings a day still show a second
 * wind, at a sixth of the cost. After two weeks a video is no longer news to
 * a finder of new things, and its readings stop.
 */
export const TRACKED_UNTIL_MS = 14 * MS_PER_DAY;

export type ReadPlan =
  | { readonly tier: Exclude<Tier, 'done'>; readonly nextReadAt: Date }
  | { readonly tier: 'done'; readonly nextReadAt: null };

/** The tier a video published at `publishedAt` is on at `now`, and when it is next read. */
export function planNextRead(publishedAt: Date, now: Date): ReadPlan {
  const age = now.getTime() - publishedAt.getTime();
  if (age >= TRACKED_UNTIL_MS) return { tier: 'done', nextReadAt: null };
  if (age >= HOURLY_UNTIL_MS) {
    return { tier: 'six_hourly', nextReadAt: new Date(now.getTime() + SIX_HOURLY_READ_MS) };
  }
  return { tier: 'hourly', nextReadAt: new Date(now.getTime() + HOURLY_READ_MS) };
}

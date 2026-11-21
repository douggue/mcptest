import type { DatePrecision } from '../sources/types';
import type { ViewSnapshot } from '../repos/types';

/**
 * A video's views at a given age, from its stored readings. A reading counts
 * as "at that age" when it was taken within a window around it: a quarter of
 * the age, and never less than a day. With no reading in the window, or an
 * upload date known only roughly (such as "2 months ago"), the views at that
 * age are not known and the comparison is said to be impossible.
 */

const DAY_MS = 86_400_000;
/** The window around the age asked: this share of it, never under SAME_AGE_MIN_DAYS. */
export const SAME_AGE_SHARE = 0.25;
export const SAME_AGE_MIN_DAYS = 1;

/** How far off an upload date of each precision may be, in days: half its unit. */
const DATE_SLACK_DAYS: Readonly<Record<DatePrecision, number>> = {
  hour: 0.5 / 24,
  day: 0.5,
  week: 3.5,
  month: 15,
  year: 182.5,
};

export type AgeViews =
  | { readonly status: 'comparable'; readonly ageDays: number; readonly views: number }
  | {
      readonly status: 'not-comparable';
      readonly reason: 'no-reading-near-age' | 'date-too-rough';
    };

const windowFor = (ageDays: number): number =>
  Math.max(SAME_AGE_MIN_DAYS, ageDays * SAME_AGE_SHARE);

/** Whether an upload date of this precision is too rough to compare at this age. */
export const dateTooRough = (precision: DatePrecision, ageDays: number): boolean =>
  DATE_SLACK_DAYS[precision] > windowFor(ageDays);

export function viewsAtAge(
  snapshots: readonly ViewSnapshot[],
  publishedAt: Date,
  precision: DatePrecision,
  ageDays: number,
): AgeViews {
  const window = windowFor(ageDays);
  if (dateTooRough(precision, ageDays))
    return { status: 'not-comparable', reason: 'date-too-rough' };
  const nearest = snapshots
    .map((snapshot) => ({
      views: snapshot.views,
      age: (snapshot.capturedAt.getTime() - publishedAt.getTime()) / DAY_MS,
    }))
    .filter((reading) => Math.abs(reading.age - ageDays) <= window)
    .sort((a, b) => Math.abs(a.age - ageDays) - Math.abs(b.age - ageDays))[0];
  return nearest
    ? { status: 'comparable', ageDays: nearest.age, views: nearest.views }
    : { status: 'not-comparable', reason: 'no-reading-near-age' };
}

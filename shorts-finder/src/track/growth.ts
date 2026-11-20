/**
 * A tracked video's growth in five figures: its views at 1 hour, 6 hours, 24
 * hours, 72 hours and 7 days after publication. Videos are read at whatever
 * moments their rounds fall on, so no two have readings at the same ages;
 * these figures put them all on the same marks, which is what lets one video
 * be placed among others "at the same age" with a simple query, and lets the
 * raw readings go once tracking has ended.
 *
 * Each figure is worked out once, by a straight line between the two readings
 * on either side of the mark. A mark with no reading on both sides stays
 * empty: nothing is ever guessed beyond the readings.
 */
import type { ViewReading } from './velocity';

const MS_PER_HOUR = 60 * 60 * 1000;

export interface GrowthSummary {
  readonly views1h: number | null;
  readonly views6h: number | null;
  readonly views24h: number | null;
  readonly views72h: number | null;
  readonly views7d: number | null;
}

export type GrowthMark = keyof GrowthSummary;

/** The ages the figures are taken at, in hours after publication. */
export const GROWTH_MARK_HOURS: Readonly<Record<GrowthMark, number>> = {
  views1h: 1,
  views6h: 6,
  views24h: 24,
  views72h: 72,
  views7d: 7 * 24,
};

export const GROWTH_MARKS = Object.keys(GROWTH_MARK_HOURS) as readonly GrowthMark[];

export const NO_GROWTH: GrowthSummary = {
  views1h: null,
  views6h: null,
  views24h: null,
  views72h: null,
  views7d: null,
};

/**
 * The views a video had at an age, from the readings on either side of it:
 * the reading at that very moment when there is one, otherwise the point on
 * the straight line between the nearest reading before and the nearest after.
 * Null when the age is not between two readings.
 */
export function viewsAtAge(
  readings: readonly ViewReading[],
  publishedAt: Date,
  ageMs: number,
): number | null {
  const at = publishedAt.getTime() + ageMs;
  const sorted = readings.toSorted((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const before = sorted.findLast((reading) => reading.capturedAt.getTime() <= at);
  const after = sorted.find((reading) => reading.capturedAt.getTime() >= at);
  if (before === undefined || after === undefined) return null;
  const span = after.capturedAt.getTime() - before.capturedAt.getTime();
  if (span === 0) return before.views;
  const part = (at - before.capturedAt.getTime()) / span;
  return Math.round(before.views + (after.views - before.views) * part);
}

/**
 * The summary with every empty figure filled that the readings can now fill.
 * A figure already there is left alone: each is worked out once.
 */
export function fillGrowth(
  summary: GrowthSummary,
  readings: readonly ViewReading[],
  publishedAt: Date,
): GrowthSummary {
  const filled = GROWTH_MARKS.map((mark): [GrowthMark, number | null] => [
    mark,
    summary[mark] ?? viewsAtAge(readings, publishedAt, GROWTH_MARK_HOURS[mark] * MS_PER_HOUR),
  ]);
  return Object.fromEntries(filled) as unknown as GrowthSummary;
}

/** Whether two summaries hold the same figures. */
export const sameGrowth = (a: GrowthSummary, b: GrowthSummary): boolean =>
  GROWTH_MARKS.every((mark) => a[mark] === b[mark]);

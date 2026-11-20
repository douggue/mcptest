/**
 * The daily thinning of readings. Hourly readings matter while a video is
 * young; once they are two weeks old, the day's last reading says all that is
 * still needed, and the store stays small enough for a small server.
 */
import type { ReadingRepo } from '../repos/types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/**
 * Readings are kept as taken for 14 days: as long as a video is tracked, so
 * every rate worked out while it is tracked has its full readings.
 */
export const KEEP_EVERY_READING_DAYS = 14;

export interface RollupReport {
  /** Readings older than this were thinned to one a day. */
  readonly cutoff: Date;
  readonly removed: number;
}

/** Thins readings older than 14 days to the last of each UTC day, per video. Safe to run again. */
export function rollUpOldReadings(
  readings: Pick<ReadingRepo, 'rollUpOlderThan'>,
  now: Date,
): RollupReport {
  const cutoff = new Date(now.getTime() - KEEP_EVERY_READING_DAYS * MS_PER_DAY);
  return { cutoff, removed: readings.rollUpOlderThan(cutoff) };
}

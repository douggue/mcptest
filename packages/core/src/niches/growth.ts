import type { VideoReading } from '../repos/types';

/**
 * Views a channel actually gained, measured from stored readings.
 *
 * "Views on recent uploads" is a stand-in: it cannot see an old video still
 * pulling views. Every read of a channel stores each video's view count, so
 * once a channel has been read twice the difference is a measurement.
 */

/** Only readings this recent count, to match the 30 days the other numbers cover. */
export const GROWTH_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface NicheGrowth {
  /** Views gained across the channel's stored videos between its first and latest reading. */
  readonly views: number;
  /** Days between those two readings; under one when both were taken the same day. */
  readonly days: number;
  /** When the first of the two readings was taken, as an ISO-8601 string. */
  readonly since: string;
}

/**
 * What a channel's videos gained since its earliest reading of the last 30
 * days, or null when it was read only once in that time.
 *
 * A video first seen after that earliest reading did not exist then, so all
 * its views count. One seen only at the earliest reading (deleted since, or
 * past the newest hundred) counts nothing. A count that fell counts as zero:
 * YouTube removes views it judges invalid, which is not the channel shrinking.
 */
export function viewsGained(readings: readonly VideoReading[], now: Date): NicheGrowth | null {
  const cutoff = now.getTime() - GROWTH_WINDOW_DAYS * DAY_MS;
  const recent = readings.filter((reading) => reading.capturedAt.getTime() >= cutoff);
  const times = recent.map((reading) => reading.capturedAt.getTime());
  if (times.length === 0) return null;
  const first = Math.min(...times);
  const last = Math.max(...times);
  if (last === first) return null;

  const atFirst = new Map<string, number>();
  const latest = new Map<string, VideoReading>();
  for (const reading of recent) {
    if (reading.capturedAt.getTime() === first) atFirst.set(reading.videoId, reading.views);
    const known = latest.get(reading.videoId);
    if (!known || reading.capturedAt.getTime() > known.capturedAt.getTime()) {
      latest.set(reading.videoId, reading);
    }
  }
  const views = [...latest.values()].reduce(
    (sum, reading) => sum + Math.max(0, reading.views - (atFirst.get(reading.videoId) ?? 0)),
    0,
  );
  return { views, days: (last - first) / DAY_MS, since: new Date(first).toISOString() };
}

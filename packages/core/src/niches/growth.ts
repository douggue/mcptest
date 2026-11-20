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

/** One video's earliest and latest reading inside the window. */
interface Span {
  readonly earliest: VideoReading;
  readonly latest: VideoReading;
}

/** Each video's earliest and latest reading, from readings in any order. */
function spansOf(readings: readonly VideoReading[]): readonly Span[] {
  const spans = new Map<string, Span>();
  for (const reading of readings) {
    const known = spans.get(reading.videoId);
    const at = reading.capturedAt.getTime();
    spans.set(reading.videoId, {
      earliest: known && known.earliest.capturedAt.getTime() <= at ? known.earliest : reading,
      latest: known && known.latest.capturedAt.getTime() > at ? known.latest : reading,
    });
  }
  return [...spans.values()];
}

/**
 * What one video gained since the channel's first reading at `first`. A count
 * that fell counts as zero: YouTube removes views it judges invalid, which is
 * not the channel shrinking.
 */
function gainedSince(span: Span, first: number): number {
  const { earliest, latest } = span;
  // Published since the first reading: every view it has was gained since then.
  if (earliest.capturedAt.getTime() > first && earliest.publishedAt.getTime() >= first) {
    return latest.views;
  }
  // Otherwise only what was seen to be gained: from its own first reading on.
  return Math.max(0, latest.views - earliest.views);
}

/**
 * What a channel's videos gained since its earliest reading of the last 30
 * days, or null when it was read only once in that time.
 *
 * Only growth inside that time counts. A video published after the earliest
 * reading did not exist then, so all its views count. An older video that was
 * merely missing from the earliest reading (the channel was read less deeply
 * that day, or the video was private) counts what it gained since it was first
 * seen, not the views of its whole life. One seen only once (deleted since, or
 * past the newest hundred) counts nothing.
 */
export function viewsGained(readings: readonly VideoReading[], now: Date): NicheGrowth | null {
  const cutoff = now.getTime() - GROWTH_WINDOW_DAYS * DAY_MS;
  const recent = readings.filter((reading) => reading.capturedAt.getTime() >= cutoff);
  const times = recent.map((reading) => reading.capturedAt.getTime());
  if (times.length === 0) return null;
  const first = Math.min(...times);
  const last = Math.max(...times);
  if (last === first) return null;

  const views = spansOf(recent).reduce((sum, span) => sum + gainedSince(span, first), 0);
  return { views, days: (last - first) / DAY_MS, since: new Date(first).toISOString() };
}

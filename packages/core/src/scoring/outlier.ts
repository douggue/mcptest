/**
 * Outlier score: how a video's views compare with what its channel usually gets
 * at the same age.
 *
 *   score = views / (baseline * ageRamp(ageDays))
 *
 * The baseline is the median of the raw views of the channel's other videos from
 * the last 90 days. Those videos are deliberately not age-adjusted: in a fit
 * against a competitor's exported scores, raw views matched best (mean error 8%
 * across eight channels, against 12% with age-adjusted views).
 */

export const RAMP_TAU_DAYS = 4.5;
export const RECENT_WINDOW_DAYS = 90;
export const MIN_POOL_SIZE = 3;
export const FALLBACK_POOL_SIZE = 10;

export interface ScorableVideo {
  readonly id: string;
  readonly views: number;
  readonly ageDays: number;
}

export interface OutlierScore {
  /** Multiple of the views expected at this age. */
  readonly score: number;
  /** Median views of the channel's other recent videos. */
  readonly baseline: number;
  /** Baseline scaled down for the video's age. */
  readonly expected: number;
  /** How many other videos the baseline was taken from. */
  readonly sampleSize: number;
}

/** Share of its eventual views a typical video has reached after `ageDays`. */
export function ageRamp(ageDays: number): number {
  return 1 - Math.exp(-(Math.max(0, ageDays) + 1) / RAMP_TAU_DAYS);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? 0) + upper) / 2;
}

/** The videos a given video is compared against: recent ones, or the newest few if the channel is quiet. */
function comparisonPool(
  video: ScorableVideo,
  all: readonly ScorableVideo[],
): readonly ScorableVideo[] {
  const others = all.filter((other) => other.id !== video.id);
  const recent = others.filter((other) => other.ageDays <= RECENT_WINDOW_DAYS);
  if (recent.length >= MIN_POOL_SIZE) return recent;
  return [...others].sort((a, b) => a.ageDays - b.ageDays).slice(0, FALLBACK_POOL_SIZE);
}

function scoreOne(video: ScorableVideo, all: readonly ScorableVideo[]): OutlierScore | null {
  const pool = comparisonPool(video, all);
  if (pool.length < MIN_POOL_SIZE) return null;
  const baseline = median(pool.map((other) => other.views));
  if (baseline === null || baseline <= 0) return null;
  const expected = baseline * ageRamp(video.ageDays);
  return { score: video.views / expected, baseline, expected, sampleSize: pool.length };
}

/** Scores every video of one channel. A video with too little to compare against maps to null. */
export function scoreVideos(
  videos: readonly ScorableVideo[],
): ReadonlyMap<string, OutlierScore | null> {
  return new Map(videos.map((video) => [video.id, scoreOne(video, videos)]));
}

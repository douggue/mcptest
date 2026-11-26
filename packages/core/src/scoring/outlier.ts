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

/** The middle of `sorted` (ascending) with the value at `skip` left out; -1 leaves nothing out. */
function middleWithout(sorted: readonly number[], skip: number): number | null {
  const length = skip < 0 ? sorted.length : sorted.length - 1;
  if (length === 0) return null;
  const at = (index: number): number => sorted[skip >= 0 && index >= skip ? index + 1 : index] ?? 0;
  const middle = Math.floor(length / 2);
  return length % 2 === 1 ? at(middle) : (at(middle - 1) + at(middle)) / 2;
}

/** Where `value` is in `sorted` (ascending); any equal one serves, since only the values count. */
function indexOf(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((sorted[middle] ?? 0) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function scoreFrom(
  video: ScorableVideo,
  baseline: number | null,
  sampleSize: number,
): OutlierScore | null {
  if (sampleSize < MIN_POOL_SIZE || baseline === null || baseline <= 0) return null;
  const expected = baseline * ageRamp(video.ageDays);
  return { score: video.views / expected, baseline, expected, sampleSize };
}

/**
 * Scores every video of one channel. A video with too little to compare against maps to null.
 *
 * Each video is compared with the channel's other recent videos or, when
 * fewer than three of them are recent, with its ten newest others. The recent
 * views are sorted once and each video's baseline is their middle with its
 * own left out: the same numbers as sorting each pool afresh, in a fraction
 * of the time on a channel with thousands of videos.
 */
export function scoreVideos(
  videos: readonly ScorableVideo[],
): ReadonlyMap<string, OutlierScore | null> {
  const recent = videos.filter((video) => video.ageDays <= RECENT_WINDOW_DAYS);
  const recentViews = recent.map((video) => video.views).sort((a, b) => a - b);
  // Newest first; ties keep the channel's own order, as a stable sort of each pool would.
  const newest = [...videos].sort((a, b) => a.ageDays - b.ageDays);
  return new Map(
    videos.map((video) => {
      const isRecent = video.ageDays <= RECENT_WINDOW_DAYS;
      const recentOthers = recent.length - (isRecent ? 1 : 0);
      if (recentOthers >= MIN_POOL_SIZE) {
        const skip = isRecent ? indexOf(recentViews, video.views) : -1;
        return [video.id, scoreFrom(video, middleWithout(recentViews, skip), recentOthers)];
      }
      // One more than the pool holds, in case the video is among them.
      const pool = newest
        .slice(0, FALLBACK_POOL_SIZE + 1)
        .filter((other) => other.id !== video.id)
        .slice(0, FALLBACK_POOL_SIZE)
        .map((other) => other.views);
      return [video.id, scoreFrom(video, median(pool), pool.length)];
    }),
  );
}

/**
 * The first cut of the Shorts check: the length. The API has no "is a Short"
 * flag, and a video of three minutes or less may still be an ordinary, wide
 * one. So `yes` here means "short enough to be a Short", nothing more; the
 * confirmation the plan describes is a separate step, made only for videos
 * that would otherwise be reported.
 */

/** The longest a Short may be: three minutes, YouTube's limit since October 2024. */
export const SHORTS_MAX_SECONDS = 180;

/**
 * `yes` at or under the limit, `no` above it, `unknown` when the length is not
 * known (a live broadcast has none until it ends).
 */
export function shortByLength(durationSeconds: number | null): 'yes' | 'no' | 'unknown' {
  if (durationSeconds === null) return 'unknown';
  return durationSeconds <= SHORTS_MAX_SECONDS ? 'yes' : 'no';
}

import { RECENT_DAYS } from '../map/view';
import type { VideoReportRow } from '../report';
import { RECENT_WINDOW_DAYS } from '../scoring/outlier';

/**
 * Decides whether one video outperforms: it drew far more views than its
 * channel's size or habits would predict, and enough of them to mean something.
 */

/** Only videos this recent count: the point is what works now. */
export const NICHE_OUTPERFORM_WINDOW_DAYS = RECENT_DAYS;
/**
 * A video at this multiple of its channel's usual views is a strong outlier.
 * The breakout feed starts at 2x, which a good week reaches, and the rising
 * rule asks for 10x twice over. One video at 5x is past luck without needing
 * a repeat. On the owner's store 3x and 5x list almost the same channels.
 */
export const NICHE_MIN_OUTLIER_SCORE = 5;
/**
 * A video seen by this many times the channel's subscribers reached mostly
 * strangers: YouTube recommended it on the topic and the packaging, not on the
 * channel's name. This also catches a channel with too few videos to score.
 */
export const NICHE_MIN_VIEWS_PER_SUBSCRIBER = 10;
/**
 * Whatever the multiple, the video must have this many views. A score of 800x
 * on a channel that usually gets a dozen views, or 300 views on a channel with
 * one subscriber, is a few hundred people and proves nothing about a niche.
 */
export const NICHE_MIN_VIDEO_VIEWS = 10_000;

/** Whether a video is recent, widely seen, and far above its channel's usual or its size. */
export function isOutperformer(row: VideoReportRow, subscribers: number | null): boolean {
  if (row.ageDays > NICHE_OUTPERFORM_WINDOW_DAYS || row.views < NICHE_MIN_VIDEO_VIEWS) {
    return false;
  }
  const beatsUsual = row.score !== null && row.score >= NICHE_MIN_OUTLIER_SCORE;
  const beatsSize =
    subscribers !== null &&
    subscribers > 0 &&
    row.views >= subscribers * NICHE_MIN_VIEWS_PER_SUBSCRIBER;
  return beatsUsual || beatsSize;
}

export interface HitRate {
  /** Of the channel's scored videos from the last 90 days, how many were strong outliers. */
  readonly hitCount: number;
  readonly scoredCount: number;
}

/** How often a channel breaks out, so a one-off can be told from a pattern. */
export function hitRate(report: readonly VideoReportRow[]): HitRate {
  const scored = report.filter((row) => row.score !== null && row.ageDays <= RECENT_WINDOW_DAYS);
  return {
    hitCount: scored.filter((row) => (row.score ?? 0) >= NICHE_MIN_OUTLIER_SCORE).length,
    scoredCount: scored.length,
  };
}

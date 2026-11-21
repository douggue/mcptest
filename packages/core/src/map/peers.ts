import { PEER_DORMANT_AFTER_DAYS } from '../limits';
import type { StoredVideo } from '../repos/types';

/**
 * Decides whether a channel on the map is a peer of the centre (the same kind
 * of channel, competing for the same viewers) or merely something YouTube
 * showed nearby, such as a news network or a large brand.
 */

/** Beyond this size a channel is an institution, not a peer of a small channel. */
export const PEER_MAX_SUBSCRIBERS = 1_000_000;
/** A channel this many times the reference's size is in another league, whatever its titles say. */
export const PEER_MAX_SIZE_RATIO = 20;
/**
 * The size ratio never brings the limit below this. Under it every channel is
 * still small: one with 30 subscribers can learn from one with 100,000.
 */
export const PEER_SIZE_RATIO_FLOOR = 150_000;
/** News desks and clip channels publish many times a day; a made-to-order video channel does not. */
export const PEER_MAX_UPLOADS_PER_WEEK = 14;
/** A peer's typical video is within this factor of the centre's, shorter or longer. */
export const PEER_MAX_DURATION_RATIO = 4;
export const PEER_MIN_DURATION_RATIO = 0.4;
/**
 * Title match (0 to 1) needed to count as making the same kind of video.
 *
 * It sits where outsiders run out on the one large map measured so far (285
 * channels against a model): 11 channels score 10-12%, 7 score 12-14%, only 3
 * score 14-18%, and the clear look-alikes start at 18%. Channels within a
 * point or two of it are not settled by titles.
 */
export const PEER_MIN_TITLE_MATCH = 0.14;
export { PEER_DORMANT_AFTER_DAYS };

export const CADENCE_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 'dormant': no upload in the last `PEER_DORMANT_AFTER_DAYS` days. */
export type OutsideReason = 'larger' | 'dormant' | 'cadence' | 'length' | 'titles';

export interface PeerSubject {
  readonly subscribers: number | null;
  readonly videos: readonly StoredVideo[];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

export function medianDurationSeconds(videos: readonly StoredVideo[]): number | null {
  return median(
    videos.flatMap((video) => (video.durationSeconds === null ? [] : [video.durationSeconds])),
  );
}

export function uploadsPerWeek(videos: readonly StoredVideo[], now: Date): number {
  const cutoff = now.getTime() - CADENCE_WINDOW_DAYS * DAY_MS;
  const recent = videos.filter((video) => video.published.date.getTime() >= cutoff).length;
  return recent / (CADENCE_WINDOW_DAYS / 7);
}

/**
 * Whether a channel's newest stored upload is older than the dormancy limit.
 * A channel with no stored video is not called dormant: nothing was read to
 * show it has stopped.
 */
export function isDormant(videos: readonly StoredVideo[], now: Date): boolean {
  if (videos.length === 0) return false;
  const newest = Math.max(...videos.map((video) => video.published.date.getTime()));
  return now.getTime() - newest > PEER_DORMANT_AFTER_DAYS * DAY_MS;
}

/**
 * The most subscribers a peer of a channel this size can have. Title matching
 * alone let channels of 400,000 to 800,000 subscribers through as look-alikes
 * of one with 8,000; a channel that much larger is not competing on the same terms.
 */
export function maxPeerSubscribers(referenceSubscribers: number | null): number {
  if (referenceSubscribers === null) return PEER_MAX_SUBSCRIBERS;
  return Math.min(
    PEER_MAX_SUBSCRIBERS,
    Math.max(PEER_SIZE_RATIO_FLOOR, referenceSubscribers * PEER_MAX_SIZE_RATIO),
  );
}

/**
 * Why a channel cannot be a peer on its shape alone (size, whether it still
 * uploads, publishing rate, video length), or null when its shape fits. Titles are judged separately.
 */
export function shapeMismatch(
  center: PeerSubject,
  candidate: PeerSubject,
  now: Date,
): Exclude<OutsideReason, 'titles'> | null {
  if (
    candidate.subscribers !== null &&
    candidate.subscribers > maxPeerSubscribers(center.subscribers)
  ) {
    return 'larger';
  }
  if (isDormant(candidate.videos, now)) return 'dormant';
  if (uploadsPerWeek(candidate.videos, now) > PEER_MAX_UPLOADS_PER_WEEK) return 'cadence';
  const own = medianDurationSeconds(center.videos);
  const theirs = medianDurationSeconds(candidate.videos);
  if (own !== null && theirs !== null && own > 0) {
    const ratio = theirs / own;
    if (ratio > PEER_MAX_DURATION_RATIO || ratio < PEER_MIN_DURATION_RATIO) return 'length';
  }
  return null;
}

/** The first reason a channel is not a peer, or null when it is one. */
export function outsideReason(
  shape: Exclude<OutsideReason, 'titles'> | null,
  titleMatch: number,
): OutsideReason | null {
  if (shape) return shape;
  return titleMatch < PEER_MIN_TITLE_MATCH ? 'titles' : null;
}

import type { StoredVideo } from '../repos/types';

/**
 * Decides whether a channel on the map is a peer of the centre (the same kind
 * of channel, competing for the same viewers) or merely something YouTube
 * showed nearby, such as a news network or a large brand.
 */

/** Beyond this size a channel is an institution, not a peer of a small channel. */
export const PEER_MAX_SUBSCRIBERS = 1_000_000;
/** News desks and clip channels publish many times a day; a made-to-order video channel does not. */
export const PEER_MAX_UPLOADS_PER_WEEK = 14;
/** A peer's typical video is within this factor of the centre's, shorter or longer. */
export const PEER_MAX_DURATION_RATIO = 4;
export const PEER_MIN_DURATION_RATIO = 0.4;
/** Title match (0 to 1) needed to count as making the same kind of video. */
export const PEER_MIN_TITLE_MATCH = 0.14;

const CADENCE_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type OutsideReason = 'larger' | 'cadence' | 'length' | 'titles';

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
 * Why a channel cannot be a peer on its shape alone (size, publishing rate,
 * video length), or null when its shape fits. Titles are judged separately.
 */
export function shapeMismatch(
  center: PeerSubject,
  candidate: PeerSubject,
  now: Date,
): Exclude<OutsideReason, 'titles'> | null {
  if (candidate.subscribers !== null && candidate.subscribers > PEER_MAX_SUBSCRIBERS) {
    return 'larger';
  }
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

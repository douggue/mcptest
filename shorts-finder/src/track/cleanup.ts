/**
 * The daily clean-up: what keeps the store from growing for ever on a small
 * server, and what keeps data read from the API from being held long after
 * anything reads it again. It reads nothing from YouTube.
 */
import type { Store } from '../repos/types';
import { finishTracking } from './finish';
import { TRACKED_UNTIL_MS } from './tiers';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/**
 * A video is deleted 30 days after its tracking ended, unless a finding is
 * about it. Thirty days is a starting value chosen for the store's size and
 * for having something to look back at; it has NOT been checked against
 * Google's API Services terms, which limit how long API data may be kept
 * without being refreshed. That check must be made against the current
 * policy text before this number is treated as settled, and the number
 * lowered if the terms ask for less.
 */
export const RETENTION_DAYS = 30;

export type CleanupStore = Pick<
  Store,
  'videos' | 'channels' | 'readings' | 'growth' | 'tracking' | 'passedOver' | 'transact'
>;

export interface CleanupReport {
  /**
   * Videos whose tracking was ended here for being past 14 days old: ones
   * that were put off round after round and so never had a last reading.
   */
  readonly agedOut: number;
  /** Videos deleted: tracking ended more than the retention ago, and no finding is about them. */
  readonly videosDeleted: number;
  /** Channels deleted: none of their videos is left, and they are not followed. */
  readonly channelsDeleted: number;
  /** Videos passed over that long ago and now forgotten. */
  readonly passedOverForgotten: number;
}

/**
 * Ends the tracking of every video past the age at which tracking stops. A
 * video that is read ends its tracking in that read; this catches the ones
 * that were always put off, so their growth is summed up and their readings
 * go like everyone else's.
 */
export function endOverdueTracking(store: CleanupStore, now: Date): number {
  const cutoff = new Date(now.getTime() - TRACKED_UNTIL_MS);
  const overdue = store.tracking.listPublishedBefore(cutoff);
  store.transact(() => {
    for (const videoId of overdue) {
      const video = store.videos.get(videoId);
      if (video === null) continue;
      const { publishedAt } = video;
      finishTracking(store, { videoId, publishedAt, reason: 'aged_out', at: now });
    }
  });
  return overdue.length;
}

/**
 * Runs the daily clean-up. Videos no longer read are removed once the
 * retention has passed, with their growth summary, tracking and hits; a
 * finding outlives its video, since it keeps its own copy of what it needs.
 * Channels go once nothing of theirs is left, unless they are followed. Safe
 * to run again: a second run finds nothing left to do.
 */
export function runDailyCleanup(store: CleanupStore, now: Date): CleanupReport {
  const agedOut = endOverdueTracking(store, now);
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * MS_PER_DAY);
  let report: CleanupReport = {
    agedOut,
    videosDeleted: 0,
    channelsDeleted: 0,
    passedOverForgotten: 0,
  };
  store.transact(() => {
    const videosDeleted = store.videos.deleteFinishedBefore(cutoff);
    // After the videos, so a channel whose last video just went goes with it.
    const channelsDeleted = store.channels.deleteWithoutVideos();
    const passedOverForgotten = store.passedOver.deleteOlderThan(cutoff);
    report = { agedOut, videosDeleted, channelsDeleted, passedOverForgotten };
  });
  return report;
}

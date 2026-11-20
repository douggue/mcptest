/**
 * The daily clean-up: what keeps the store from growing for ever on a small
 * server. It reads nothing from YouTube.
 */
import type { Store } from '../repos/types';
import { finishTracking } from './finish';
import { TRACKED_UNTIL_MS } from './tiers';

export type CleanupStore = Pick<Store, 'videos' | 'readings' | 'growth' | 'tracking' | 'transact'>;

export interface CleanupReport {
  /**
   * Videos whose tracking was ended here for being past 14 days old: ones
   * that were put off round after round and so never had a last reading.
   */
  readonly agedOut: number;
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

/** Runs the daily clean-up. Safe to run again: a second run finds nothing left to do. */
export function runDailyCleanup(store: CleanupStore, now: Date): CleanupReport {
  return { agedOut: endOverdueTracking(store, now) };
}

/**
 * Keeping a video's growth summary up to date, and ending its tracking: the
 * summary is completed from the readings there are, and the readings
 * themselves, by far the most rows in the store, are removed.
 */
import type { FinishReason, Store } from '../repos/types';
import { NO_GROWTH, fillGrowth, sameGrowth } from './growth';
import type { ViewReading } from './velocity';

type GrowthStore = Pick<Store, 'growth'>;
type FinishStore = Pick<Store, 'growth' | 'readings' | 'tracking'>;

/** Fills whichever of the video's growth figures its readings can now fill. */
export function updateGrowth(
  store: GrowthStore,
  videoId: string,
  readings: readonly ViewReading[],
  publishedAt: Date,
): void {
  const before = store.growth.get(videoId);
  const filled = fillGrowth(before ?? NO_GROWTH, readings, publishedAt);
  if (before === null || !sameGrowth(before, filled)) store.growth.save(videoId, filled);
}

export interface Finishing {
  readonly videoId: string;
  readonly publishedAt: Date;
  readonly reason: FinishReason;
  readonly at: Date;
}

/**
 * Ends a video's tracking: completes its growth summary and removes its raw
 * readings. One exception: a video that ended as `gone` keeps its readings.
 * "Gone" is a judgement from the API's silence, and if it was wrong nothing
 * should have been thrown away on the strength of it; the retention clean-up
 * removes them with the video in its own time.
 */
export function finishTracking(store: FinishStore, finishing: Finishing): void {
  const { videoId, publishedAt, reason, at } = finishing;
  const readings = store.readings.list(videoId, new Date(0), at);
  const before = store.growth.get(videoId);
  store.growth.complete(videoId, fillGrowth(before ?? NO_GROWTH, readings, publishedAt), at);
  if (reason !== 'gone') store.readings.deleteForVideo(videoId);
  store.tracking.finish(videoId, reason, at);
}

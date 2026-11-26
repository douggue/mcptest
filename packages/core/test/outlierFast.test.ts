import { describe, expect, test } from 'vitest';
import {
  FALLBACK_POOL_SIZE,
  MIN_POOL_SIZE,
  RECENT_WINDOW_DAYS,
  ageRamp,
  median,
  scoreVideos,
  type OutlierScore,
  type ScorableVideo,
} from '../src/scoring/outlier';

/** The score as first written: each video's pool built and sorted afresh. */
function scoreOneByOne(videos: readonly ScorableVideo[]): ReadonlyMap<string, OutlierScore | null> {
  const scoreOne = (video: ScorableVideo): OutlierScore | null => {
    const others = videos.filter((other) => other.id !== video.id);
    const recent = others.filter((other) => other.ageDays <= RECENT_WINDOW_DAYS);
    const pool =
      recent.length >= MIN_POOL_SIZE
        ? recent
        : [...others].sort((a, b) => a.ageDays - b.ageDays).slice(0, FALLBACK_POOL_SIZE);
    if (pool.length < MIN_POOL_SIZE) return null;
    const baseline = median(pool.map((other) => other.views));
    if (baseline === null || baseline <= 0) return null;
    const expected = baseline * ageRamp(video.ageDays);
    return { score: video.views / expected, baseline, expected, sampleSize: pool.length };
  };
  return new Map(videos.map((video) => [video.id, scoreOne(video)]));
}

/** A small seeded generator, so a failure can be run again. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function channel(random: () => number, size: number, recentShare: number): ScorableVideo[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `v${index}`,
    // Repeated views and ages, as real channels have.
    views: Math.floor(random() * 50) * (random() < 0.1 ? 1000 : 10),
    ageDays:
      random() < recentShare
        ? Math.floor(random() * RECENT_WINDOW_DAYS)
        : RECENT_WINDOW_DAYS + 1 + Math.floor(random() * 30),
  }));
}

describe('scoring a channel all at once', () => {
  test('gives exactly the scores of scoring each video on its own', () => {
    const random = seeded(7);
    for (let round = 0; round < 300; round += 1) {
      const size = Math.floor(random() * 40);
      const videos = channel(random, size, random());

      expect(scoreVideos(videos)).toEqual(scoreOneByOne(videos));
    }
  });

  test('gives the same scores for a quiet channel compared with its newest videos', () => {
    const random = seeded(11);
    const videos = channel(random, 60, 0.03);

    expect(scoreVideos(videos)).toEqual(scoreOneByOne(videos));
  });
});

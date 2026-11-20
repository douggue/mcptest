import { describe, expect, test } from 'vitest';
import { ageRamp, median, scoreVideos, type ScorableVideo } from '../src/scoring/outlier';
import exportScores from './fixtures/export-scores.json';

const video = (id: string, views: number, ageDays: number): ScorableVideo => ({
  id,
  views,
  ageDays,
});

describe('ageRamp', () => {
  test('expects about a fifth of the usual views on the first day', () => {
    expect(ageRamp(0)).toBeCloseTo(0.199, 3);
  });

  test('rises with age and levels off near one', () => {
    expect(ageRamp(1)).toBeGreaterThan(ageRamp(0));
    expect(ageRamp(7)).toBeCloseTo(0.831, 3);
    expect(ageRamp(30)).toBeGreaterThan(0.99);
  });

  test('treats negative ages as day zero', () => {
    expect(ageRamp(-2)).toBe(ageRamp(0));
  });
});

describe('median', () => {
  test('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  test('returns null for an empty list', () => {
    expect(median([])).toBeNull();
  });
});

describe('scoreVideos', () => {
  test('scores a mature video against the median of the others', () => {
    const videos = [
      video('hit', 10_000, 40),
      video('a', 1000, 35),
      video('b', 1000, 45),
      video('c', 1000, 50),
      video('d', 1000, 60),
    ];

    const scores = scoreVideos(videos);

    expect(scores.get('hit')?.score).toBeCloseTo(10, 1);
    expect(scores.get('hit')?.baseline).toBe(1000);
    expect(scores.get('hit')?.sampleSize).toBe(videos.length - 1);
    expect(scores.get('a')?.score).toBeCloseTo(1, 1);
  });

  test('expects fewer views from a video published today', () => {
    const videos = [
      video('new', 200, 0),
      video('a', 1000, 35),
      video('b', 1000, 45),
      video('c', 1000, 50),
    ];

    expect(scoreVideos(videos).get('new')?.score).toBeCloseTo(200 / (1000 * ageRamp(0)), 5);
  });

  test('ignores videos older than 90 days when enough recent ones exist', () => {
    const videos = [
      video('hit', 5000, 10),
      video('a', 1000, 20),
      video('b', 1000, 30),
      video('c', 1000, 40),
      video('old1', 900_000, 200),
      video('old2', 900_000, 300),
      video('old3', 900_000, 400),
    ];

    expect(scoreVideos(videos).get('hit')?.baseline).toBe(1000);
  });

  test('falls back to the ten most recent others when few are recent', () => {
    const videos = [
      video('hit', 5000, 10),
      video('a', 2000, 120),
      video('b', 2000, 150),
      video('c', 2000, 200),
    ];

    expect(scoreVideos(videos).get('hit')?.baseline).toBe(2000);
  });

  test('gives no score when there are fewer than three other videos', () => {
    const scores = scoreVideos([video('x', 100, 5), video('y', 100, 6), video('z', 100, 7)]);

    expect(scores.get('x')).toBeNull();
  });

  test('gives no score when the usual views are zero', () => {
    const videos = [video('x', 50, 5), video('a', 0, 6), video('b', 0, 7), video('c', 0, 8)];

    expect(scoreVideos(videos).get('x')).toBeNull();
  });

  test('reproduces the scores in a competitor export within 15% at the median', () => {
    const videos = exportScores.map((row, index) => video(String(index), row.views, row.age));
    const scores = scoreVideos(videos);
    const errors = exportScores
      .map((row, index) => ({ stated: row.stated, mine: scores.get(String(index))?.score }))
      .filter((pair): pair is { stated: number; mine: number } => {
        return pair.stated !== null && pair.stated >= 0.3 && pair.mine !== undefined;
      })
      .map((pair) => Math.abs(pair.mine - pair.stated) / pair.stated);

    expect(errors.length).toBeGreaterThan(20);
    expect(median(errors)).toBeLessThan(0.15);
  });
});

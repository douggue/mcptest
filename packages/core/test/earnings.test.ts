import { describe, expect, test } from 'vitest';
import {
  LONG_FORM_RATE,
  MIN_SUBSCRIBERS_FOR_ADS,
  SHORTS_RATE,
  estimateEarnings,
} from '../src/scoring/earnings';

const long = (views: number, minutes = 15) => ({ views, durationSeconds: minutes * 60 });
const short = (views: number) => ({ views, durationSeconds: 45 });

describe('estimateEarnings', () => {
  test('turns long-video views into a low-to-high range in whole dollars', () => {
    const estimate = estimateEarnings([long(600_000), long(400_000)], 5000);

    expect(estimate).toEqual({
      low: (1_000_000 / 1000) * LONG_FORM_RATE.low,
      high: (1_000_000 / 1000) * LONG_FORM_RATE.high,
      longFormViews: 1_000_000,
      shortsViews: 0,
      belowAdThreshold: false,
    });
  });

  test('counts Shorts at their own, far lower, rate', () => {
    const estimate = estimateEarnings([long(100_000), short(2_000_000)], 5000);

    expect(estimate.longFormViews).toBe(100_000);
    expect(estimate.shortsViews).toBe(2_000_000);
    expect(estimate.low).toBe(Math.round(100 * LONG_FORM_RATE.low + 2000 * SHORTS_RATE.low));
    expect(estimate.high).toBe(Math.round(100 * LONG_FORM_RATE.high + 2000 * SHORTS_RATE.high));
  });

  test('treats a video of unknown length as a long one', () => {
    const estimate = estimateEarnings([{ views: 50_000, durationSeconds: null }], 5000);

    expect(estimate.longFormViews).toBe(50_000);
  });

  test('flags a channel too small to be paid for ads yet, and still shows what the views are worth', () => {
    const estimate = estimateEarnings([long(200_000)], MIN_SUBSCRIBERS_FOR_ADS - 1);

    expect(estimate.belowAdThreshold).toBe(true);
    expect(estimate.high).toBeGreaterThan(0);
  });

  test('does not guess the threshold when the subscriber count is hidden', () => {
    expect(estimateEarnings([long(200_000)], null).belowAdThreshold).toBeNull();
  });

  test('gives zero for a channel with no videos in the period', () => {
    expect(estimateEarnings([], 5000)).toMatchObject({ low: 0, high: 0 });
  });

  test('uses the rates it is given', () => {
    const estimate = estimateEarnings([long(1_000_000)], 5000, {
      longForm: { low: 10, high: 20 },
      shorts: SHORTS_RATE,
    });

    expect([estimate.low, estimate.high]).toEqual([10_000, 20_000]);
  });
});

import { describe, expect, test } from 'vitest';
import {
  MIN_SUBSCRIBERS_FOR_ADS,
  SHORTS_RATE,
  estimateShortsEarnings,
} from '../src/scoring/earnings';

describe('estimateShortsEarnings', () => {
  test("turns views into a low-to-high range at the owner's Shorts rate", () => {
    const estimate = estimateShortsEarnings(2_000_000, 5000);

    expect(estimate).toEqual({
      low: 2000 * SHORTS_RATE.low,
      high: 2000 * SHORTS_RATE.high,
      views: 2_000_000,
      belowAdThreshold: false,
    });
    expect(SHORTS_RATE).toEqual({ low: 0.1, high: 0.5 });
  });

  test('keeps cents, because a small Short is worth less than a dollar', () => {
    const estimate = estimateShortsEarnings(1234, 5000);

    expect(estimate.low).toBe(0.12);
    expect(estimate.high).toBe(0.62);
  });

  test('flags a channel too small to be paid for ads yet, and still says what the views are worth', () => {
    const estimate = estimateShortsEarnings(300_000, MIN_SUBSCRIBERS_FOR_ADS - 1);

    expect(estimate.belowAdThreshold).toBe(true);
    expect(estimate.low).toBe(30);
    expect(estimate.high).toBe(150);
  });

  test('does not flag a channel that has just reached the subscriber threshold', () => {
    expect(estimateShortsEarnings(1000, MIN_SUBSCRIBERS_FOR_ADS).belowAdThreshold).toBe(false);
  });

  test('cannot say whether a channel with a hidden subscriber count is paid', () => {
    expect(estimateShortsEarnings(1000, null).belowAdThreshold).toBeNull();
  });

  test('values no views at nothing', () => {
    expect(estimateShortsEarnings(0, 10)).toMatchObject({ low: 0, high: 0, views: 0 });
  });

  test('uses another rate when given one', () => {
    const estimate = estimateShortsEarnings(100_000, 5000, { low: 0.02, high: 0.07 });

    expect(estimate.low).toBe(2);
    expect(estimate.high).toBe(7);
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('refuses a view count of %s', (views) => {
    expect(() => estimateShortsEarnings(views, 5000)).toThrow(RangeError);
  });
});

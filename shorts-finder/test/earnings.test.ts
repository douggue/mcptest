import { describe, expect, test } from 'vitest';
import {
  DEFAULT_ENGAGED_SHARE,
  DEFAULT_SHORTS_RATE,
  SUBSCRIBER_THRESHOLD,
  estimateShortsEarnings,
} from '../src/scoring/earnings';

describe('estimateShortsEarnings', () => {
  test('turns views into a low-to-high range at the default Shorts rate', () => {
    const estimate = estimateShortsEarnings(2_000_000, 5000);

    expect(estimate).toEqual({
      low: 2000 * DEFAULT_SHORTS_RATE.low,
      high: 2000 * DEFAULT_SHORTS_RATE.high,
      views: 2_000_000,
      upperBound: true,
      belowSubscriberThreshold: false,
    });
    expect(DEFAULT_SHORTS_RATE).toEqual({ low: 0.1, high: 0.5 });
  });

  test('keeps cents, because a small Short is worth less than a dollar', () => {
    const estimate = estimateShortsEarnings(1234, 5000);

    expect(estimate.low).toBe(0.12);
    expect(estimate.high).toBe(0.62);
  });

  test('flags a channel below the subscriber threshold, and still says what the views are worth', () => {
    const estimate = estimateShortsEarnings(300_000, SUBSCRIBER_THRESHOLD - 1);

    expect(estimate.belowSubscriberThreshold).toBe(true);
    expect(estimate.low).toBe(30);
    expect(estimate.high).toBe(150);
  });

  test('does not flag a channel that has just reached the subscriber threshold', () => {
    expect(estimateShortsEarnings(1000, SUBSCRIBER_THRESHOLD).belowSubscriberThreshold).toBe(false);
  });

  test('cannot say which side of the threshold a channel with a hidden subscriber count is on', () => {
    expect(estimateShortsEarnings(1000, null).belowSubscriberThreshold).toBeNull();
  });

  test('values no views at nothing', () => {
    expect(estimateShortsEarnings(0, 10)).toMatchObject({ low: 0, high: 0, views: 0 });
  });

  test('uses another rate when given one', () => {
    const estimate = estimateShortsEarnings(100_000, 5000, { low: 0.02, high: 0.07 });

    expect(estimate.low).toBe(2);
    expect(estimate.high).toBe(7);
  });

  test('takes the engaged share off the views before the rate, and then is no longer an upper bound', () => {
    const half = estimateShortsEarnings(300_000, 5000, DEFAULT_SHORTS_RATE, 0.5);
    const none = estimateShortsEarnings(300_000, 5000, DEFAULT_SHORTS_RATE, 0);

    expect(half).toMatchObject({ low: 15, high: 75, views: 300_000, upperBound: false });
    expect(none).toMatchObject({ low: 0, high: 0, upperBound: false });
    expect(DEFAULT_ENGAGED_SHARE).toBe(1);
  });

  test.each([-0.1, 1.01, Number.NaN])('refuses an engaged share of %s', (share) => {
    expect(() => estimateShortsEarnings(1000, 5000, DEFAULT_SHORTS_RATE, share)).toThrow(
      RangeError,
    );
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('refuses a view count of %s', (views) => {
    expect(() => estimateShortsEarnings(views, 5000)).toThrow(RangeError);
  });
});

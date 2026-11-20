import { describe, expect, test } from 'vitest';
import {
  GROWTH_MARKS,
  GROWTH_MARK_HOURS,
  NO_GROWTH,
  fillGrowth,
  sameGrowth,
  viewsAtAge,
} from '../src/track/growth';
import type { ViewReading } from '../src/track/velocity';
import { HOUR_MS, MINUTE_MS, NOW } from './fixtures/facts';

/** Published at `NOW`; readings so many hours after that, with these views. */
const PUBLISHED = NOW;
const readings = (...points: ReadonlyArray<readonly [hoursOld: number, views: number]>) =>
  points.map(([hoursOld, views]): ViewReading => ({
    capturedAt: new Date(PUBLISHED.getTime() + hoursOld * HOUR_MS),
    views,
  }));

describe('viewsAtAge', () => {
  test('takes the point on the straight line between the readings on either side of the age', () => {
    const taken = readings([0.5, 100], [1.5, 300], [5, 1000], [8, 1600]);

    expect(viewsAtAge(taken, PUBLISHED, HOUR_MS)).toBe(200);
    expect(viewsAtAge(taken, PUBLISHED, 6 * HOUR_MS)).toBe(1200);
  });

  test('takes a reading at that very moment as it stands', () => {
    expect(viewsAtAge(readings([6, 777], [9, 900]), PUBLISHED, 6 * HOUR_MS)).toBe(777);
    expect(viewsAtAge(readings([6, 777]), PUBLISHED, 6 * HOUR_MS)).toBe(777);
  });

  test('uses the nearest reading on each side, in whatever order the readings come', () => {
    const shuffled = readings([30, 9000], [20, 4000], [2, 100], [26, 7000]);

    expect(viewsAtAge(shuffled, PUBLISHED, 24 * HOUR_MS)).toBe(6000);
  });

  test('rounds to a whole number of views', () => {
    expect(viewsAtAge(readings([0, 0], [3, 100]), PUBLISHED, HOUR_MS)).toBe(33);
  });

  test.each([
    ['every reading is after the age: the video was found later', readings([5, 800], [6, 900])],
    ['every reading is before the age: it has not been reached', readings([0.2, 10], [0.9, 80])],
    ['there are no readings', []],
  ])('never guesses beyond the readings when %s', (_what, taken) => {
    expect(viewsAtAge(taken, PUBLISHED, HOUR_MS)).toBeNull();
  });

  test('follows a count that fell between two readings rather than inventing a gain', () => {
    expect(viewsAtAge(readings([0, 1000], [2, 800]), PUBLISHED, HOUR_MS)).toBe(900);
  });
});

describe('fillGrowth', () => {
  test('marks one hour, six hours, a day, three days and a week after publication', () => {
    expect(GROWTH_MARKS).toEqual(['views1h', 'views6h', 'views24h', 'views72h', 'views7d']);
    expect(Object.values(GROWTH_MARK_HOURS)).toEqual([1, 6, 24, 72, 168]);
  });

  test('fills the marks the readings bracket and leaves the rest empty', () => {
    const taken = readings([0.5, 100], [1.5, 300], [7, 1400], [25, 5000]);

    expect(fillGrowth(NO_GROWTH, taken, PUBLISHED)).toEqual({
      views1h: 200,
      views6h: 1200,
      views24h: 4800,
      views72h: null,
      views7d: null,
    });
  });

  test('fills each mark once: later readings do not move a figure already there', () => {
    const early = readings([0.5, 100], [1.5, 300]);
    const first = fillGrowth(NO_GROWTH, early, PUBLISHED);
    // The same moments read again with other counts, as a late correction would be.
    const later = readings([0.5, 900], [1.5, 900], [5, 1000], [7, 1400]);

    const second = fillGrowth(first, later, PUBLISHED);

    expect(second).toMatchObject({ views1h: 200, views6h: 1200 });
  });

  test('leaves a video found after a mark without that figure for good', () => {
    const foundLate = readings([10, 3000], [30, 9000]);

    expect(fillGrowth(NO_GROWTH, foundLate, PUBLISHED)).toMatchObject({
      views1h: null,
      views6h: null,
      views24h: 7200,
    });
  });

  test('does not change the summary it was given', () => {
    fillGrowth(NO_GROWTH, readings([0, 0], [2, 50]), PUBLISHED);

    expect(NO_GROWTH.views1h).toBeNull();
  });
});

describe('sameGrowth', () => {
  test('tells whether two summaries hold the same figures', () => {
    const filled = { ...NO_GROWTH, views1h: 5 };

    expect(sameGrowth(NO_GROWTH, { ...NO_GROWTH })).toBe(true);
    expect(sameGrowth(NO_GROWTH, filled)).toBe(false);
    expect(MINUTE_MS).toBe(60_000);
  });
});

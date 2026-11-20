import { describe, expect, test } from 'vitest';
import {
  MIN_SPAN_MS,
  RATE_WINDOW_MS,
  velocity,
  viewsPerHour,
  type ViewReading,
} from '../src/track/velocity';
import { HOUR_MS, MINUTE_MS, NOW, at } from './fixtures/facts';

/** Readings so many hours before now, with these view counts. */
const readings = (...points: ReadonlyArray<readonly [hoursAgo: number, views: number]>) =>
  points.map(([hoursAgo, views]): ViewReading => ({ capturedAt: at(-hoursAgo * HOUR_MS), views }));

describe('viewsPerHour', () => {
  test('is the views gained across the window divided by the hours they took', () => {
    const hourly = readings(
      [6, 1000],
      [5, 1500],
      [4, 2500],
      [3, 3000],
      [2, 5000],
      [1, 6000],
      [0, 7000],
    );

    expect(viewsPerHour(hourly, NOW)).toBe(1000);
    expect(RATE_WINDOW_MS).toBe(6 * HOUR_MS);
  });

  test('looks only at the window, not at what came before it', () => {
    const withHistory = readings([30, 0], [6, 60_000], [3, 60_300], [0, 60_600]);

    expect(viewsPerHour(withHistory, NOW)).toBe(100);
  });

  test('takes readings in any order, and ignores ones after "now"', () => {
    const shuffled = readings([0, 400], [-1, 9000], [2, 200], [1, 300]);

    expect(viewsPerHour(shuffled, NOW)).toBe(100);
  });

  test('uses another window when given one', () => {
    const hourly = readings([3, 0], [2, 100], [1, 300], [0, 900]);

    expect(viewsPerHour(hourly, NOW, HOUR_MS)).toBe(600);
  });

  test('falls back to the two latest readings when the window holds fewer than two', () => {
    const sparse = readings([30, 1000], [18, 4000], [2, 12_000]);

    expect(viewsPerHour(sparse, NOW)).toBe(500);
  });

  test('counts a falling count as no gain, not as a loss', () => {
    expect(viewsPerHour(readings([2, 5000], [0, 4200]), NOW)).toBe(0);
  });

  test('measures from the first to the last reading, so a dip in between changes nothing', () => {
    expect(viewsPerHour(readings([4, 1000], [2, 600], [0, 1800]), NOW)).toBe(200);
  });

  test.each([
    ['there are no readings', []],
    ['there is one reading', readings([1, 500])],
    ['the readings are less than half an hour apart', readings([0.4, 500], [0, 900])],
    ['the only readings are after "now"', readings([-1, 500], [-3, 900])],
  ])('cannot say when %s', (_what, given) => {
    expect(viewsPerHour(given, NOW)).toBeNull();
  });

  test('can say once the readings are exactly half an hour apart', () => {
    const close: ViewReading[] = [
      { capturedAt: at(-MIN_SPAN_MS), views: 100 },
      { capturedAt: NOW, views: 150 },
    ];

    expect(viewsPerHour(close, NOW)).toBe(100);
    expect(MIN_SPAN_MS).toBe(30 * MINUTE_MS);
  });
});

describe('velocity', () => {
  test('gives the rate, how it compares with the window before, and what it was measured over', () => {
    const speeding = readings([12, 0], [9, 300], [6, 600], [3, 1800], [0, 3000]);

    expect(velocity(speeding, NOW)).toEqual({
      viewsPerHour: 400,
      acceleration: 4,
      measuredFrom: at(-6 * HOUR_MS),
      measuredTo: NOW,
    });
  });

  test('shows a video slowing down as an acceleration below one', () => {
    const slowing = readings([12, 0], [6, 6000], [0, 7500]);

    expect(velocity(slowing, NOW).acceleration).toBe(0.25);
  });

  test('shows a video that stopped gaining as an acceleration of nothing', () => {
    const stopped = readings([12, 0], [6, 6000], [0, 6000]);

    expect(velocity(stopped, NOW)).toMatchObject({ viewsPerHour: 0, acceleration: 0 });
  });

  test.each([
    ['the window before holds fewer than two readings', readings([6, 100], [3, 400], [0, 700])],
    ['the window before gained nothing', readings([12, 500], [6, 500], [3, 800], [0, 1100])],
    ['the latest window holds fewer than two readings', readings([12, 0], [9, 300], [8, 500])],
  ])('cannot give an acceleration when %s', (_what, given) => {
    expect(velocity(given, NOW).acceleration).toBeNull();
  });

  test('says which readings a fallen-back rate was measured over, so an old rate is seen to be old', () => {
    const stale = readings([40, 1000], [30, 2000]);

    expect(velocity(stale, NOW)).toEqual({
      viewsPerHour: 100,
      acceleration: null,
      measuredFrom: at(-40 * HOUR_MS),
      measuredTo: at(-30 * HOUR_MS),
    });
  });

  test('has nothing to say without readings', () => {
    expect(velocity([], NOW)).toEqual({
      viewsPerHour: null,
      acceleration: null,
      measuredFrom: null,
      measuredTo: null,
    });
  });
});

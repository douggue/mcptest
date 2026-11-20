import { describe, expect, test } from 'vitest';
import {
  BASELINE_FROM,
  BASELINE_READ_AGES_MS,
  FADE_AFTER_LOW_READINGS,
  HOURLY_UNTIL_MS,
  NO_POSITION,
  TOP_HALF_FROM,
  TRACKED_UNTIL_MS,
  initialPlan,
  planNextRead,
  retryPlan,
  type PlanInput,
  type Position,
} from '../src/track/tiers';
import { speedingUp, type ViewReading } from '../src/track/velocity';
import { DAY_MS, HOUR_MS, MINUTE_MS, NOW, at } from './fixtures/facts';

const readings = (...points: ReadonlyArray<readonly [hoursAgo: number, views: number]>) =>
  points.map(([hoursAgo, views]): ViewReading => ({ capturedAt: at(-hoursAgo * HOUR_MS), views }));

/** Gaining the same every six hours: not speeding up. */
const STEADY = readings([12, 0], [6, 600], [0, 1200]);
/** Gaining more in the last six hours than in the six before. */
const QUICKENING = readings([12, 0], [6, 600], [0, 2400]);

const UPPER: Position = { speedPercentile: 0.8, channelSizePercentile: 0.3 };
const LOWER: Position = { speedPercentile: 0.2, channelSizePercentile: 0.3 };

const plan = (ageMs: number, overrides: Partial<PlanInput> = {}) =>
  planNextRead({
    publishedAt: at(-ageMs),
    now: NOW,
    readings: STEADY,
    position: UPPER,
    lowStreak: 0,
    ...overrides,
  });

describe('planNextRead', () => {
  test('reads hourly a video under 72 hours old in the upper half of its group', () => {
    expect(plan(0)).toEqual({ tier: 'hourly', nextReadAt: at(HOUR_MS), lowStreak: 0 });
    expect(plan(HOURLY_UNTIL_MS - 1)).toMatchObject({ tier: 'hourly' });
    expect(
      plan(2 * HOUR_MS, { position: { ...UPPER, speedPercentile: TOP_HALF_FROM } }),
    ).toMatchObject({ tier: 'hourly' });
    expect(HOURLY_UNTIL_MS).toBe(72 * HOUR_MS);
    expect(TOP_HALF_FROM).toBe(0.5);
  });

  test('reads six-hourly a young video in the slower half, counting the reading against it', () => {
    expect(plan(2 * HOUR_MS, { position: LOWER })).toEqual({
      tier: 'six_hourly',
      nextReadAt: at(6 * HOUR_MS),
      lowStreak: 1,
    });
  });

  test('reads six-hourly a video past 72 hours, whatever its place', () => {
    expect(plan(HOURLY_UNTIL_MS)).toEqual({
      tier: 'six_hourly',
      nextReadAt: at(6 * HOUR_MS),
      lowStreak: 0,
    });
    expect(plan(TRACKED_UNTIL_MS - 1)).toMatchObject({ tier: 'six_hourly' });
  });

  test('ends tracking at 14 days', () => {
    expect(plan(TRACKED_UNTIL_MS)).toEqual({
      tier: 'done',
      nextReadAt: null,
      reason: 'aged_out',
      lowStreak: 0,
    });
    expect(TRACKED_UNTIL_MS).toBe(14 * DAY_MS);
  });

  test('ends tracking after three readings in a row in the slower half without speeding up', () => {
    const second = plan(30 * HOUR_MS, { position: LOWER, lowStreak: 1 });
    const third = plan(30 * HOUR_MS, { position: LOWER, lowStreak: 2 });

    expect(second).toMatchObject({ tier: 'six_hourly', lowStreak: 2 });
    expect(third).toEqual({ tier: 'done', nextReadAt: null, reason: 'faded', lowStreak: 3 });
    expect(FADE_AFTER_LOW_READINGS).toBe(3);
  });

  test('keeps a video in the slower half that is speeding up, however long it has been there', () => {
    const kept = plan(30 * HOUR_MS, { position: LOWER, lowStreak: 5, readings: QUICKENING });

    expect(kept).toMatchObject({ tier: 'six_hourly', lowStreak: 6 });
  });

  test('starts the count again once a reading finds the video in the upper half', () => {
    expect(plan(30 * HOUR_MS, { lowStreak: 2 })).toMatchObject({ tier: 'hourly', lowStreak: 0 });
  });

  test('reads by age alone a video with no known place, and does not count against it', () => {
    expect(plan(2 * HOUR_MS, { position: NO_POSITION, lowStreak: 2 })).toMatchObject({
      tier: 'hourly',
      lowStreak: 0,
    });
    expect(plan(80 * HOUR_MS, { position: NO_POSITION })).toMatchObject({ tier: 'six_hourly' });
  });

  test('reads a video from a channel in the top quarter of its group only at about 24 and 72 hours', () => {
    const large: Position = { speedPercentile: 0.9, channelSizePercentile: BASELINE_FROM };

    expect(plan(3 * HOUR_MS, { position: large })).toEqual({
      tier: 'baseline',
      nextReadAt: at(21 * HOUR_MS),
      lowStreak: 0,
    });
    expect(plan(24 * HOUR_MS, { position: large })).toEqual({
      tier: 'baseline',
      nextReadAt: at(48 * HOUR_MS),
      lowStreak: 0,
    });
    expect(plan(72 * HOUR_MS, { position: large })).toEqual({
      tier: 'done',
      nextReadAt: null,
      reason: 'baseline_done',
      lowStreak: 0,
    });
    expect(BASELINE_FROM).toBe(0.75);
    expect(BASELINE_READ_AGES_MS).toEqual([24 * HOUR_MS, 72 * HOUR_MS]);
  });

  test('does not treat as baseline a channel just under the top quarter, or one of unknown size', () => {
    const under: Position = { speedPercentile: 0.9, channelSizePercentile: 0.74 };
    const unknown: Position = { speedPercentile: 0.9, channelSizePercentile: null };

    expect(plan(3 * HOUR_MS, { position: under })).toMatchObject({ tier: 'hourly' });
    expect(plan(3 * HOUR_MS, { position: unknown })).toMatchObject({ tier: 'hourly' });
  });
});

describe('initialPlan', () => {
  test('starts a new video on the tier its age calls for, not always hourly', () => {
    expect(initialPlan(at(-2 * HOUR_MS), NOW)).toEqual({
      tier: 'hourly',
      nextReadAt: at(HOUR_MS),
    });
    expect(initialPlan(at(-HOURLY_UNTIL_MS), NOW)).toEqual({
      tier: 'six_hourly',
      nextReadAt: at(6 * HOUR_MS),
    });
  });

  test('does not track a video already past 14 days', () => {
    expect(initialPlan(at(-TRACKED_UNTIL_MS), NOW)).toBeNull();
  });
});

describe('retryPlan', () => {
  test('asks again on the tier the video is on, a baseline video at the slower pace', () => {
    const published = at(-5 * HOUR_MS);

    expect(retryPlan('hourly', published, NOW)).toEqual({
      tier: 'hourly',
      nextReadAt: at(HOUR_MS),
    });
    expect(retryPlan('six_hourly', published, NOW)?.nextReadAt).toEqual(at(6 * HOUR_MS));
    expect(retryPlan('baseline', published, NOW)).toEqual({
      tier: 'baseline',
      nextReadAt: at(6 * HOUR_MS),
    });
    expect(retryPlan('hourly', at(-TRACKED_UNTIL_MS), NOW)).toBeNull();
  });
});

describe('speedingUp', () => {
  test('compares the gain between the last two readings with the gain between the two before', () => {
    expect(speedingUp(QUICKENING)).toBe(true);
    expect(speedingUp(STEADY)).toBe(false);
    expect(speedingUp(readings([12, 0], [6, 900], [0, 1000]))).toBe(false);
  });

  test('looks at the last three readings only, in whatever order they come', () => {
    const lateBurst = readings([0, 5000], [30, 0], [12, 1000], [6, 1100], [24, 900]);

    expect(speedingUp(lateBurst)).toBe(true);
  });

  test('cannot tell from fewer than three readings, or from readings too close together', () => {
    const close: ViewReading[] = [
      { capturedAt: at(-6 * HOUR_MS), views: 0 },
      { capturedAt: at(-10 * MINUTE_MS), views: 100 },
      { capturedAt: NOW, views: 900 },
    ];

    expect(speedingUp([])).toBe(false);
    expect(speedingUp(readings([6, 0], [0, 100]))).toBe(false);
    expect(speedingUp(close)).toBe(false);
  });
});

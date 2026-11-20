import { describe, expect, test } from 'vitest';
import {
  endOfLocalDay,
  isTimeZone,
  localMoment,
  startOfLocalDay,
} from '../../src/alerts/localTime';

describe('isTimeZone', () => {
  test('knows named zones and UTC, and refuses anything else', () => {
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Europe/London')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });
});

describe('localMoment', () => {
  test('gives the day and hour in UTC', () => {
    expect(localMoment(new Date('2026-11-20T20:15:00Z'), 'UTC')).toEqual({
      day: '2026-11-20',
      hour: 20,
    });
  });

  test('gives the next day east of UTC and the day before west of it', () => {
    const instant = new Date('2026-11-20T23:30:00Z');

    expect(localMoment(instant, 'Australia/Sydney')).toEqual({ day: '2026-11-21', hour: 10 });
    expect(localMoment(new Date('2026-11-20T03:30:00Z'), 'America/Toronto')).toEqual({
      day: '2026-11-19',
      hour: 22,
    });
  });

  test('calls midnight hour 0, not 24', () => {
    expect(localMoment(new Date('2026-11-20T00:00:00Z'), 'UTC').hour).toBe(0);
  });
});

describe('startOfLocalDay and endOfLocalDay', () => {
  test('are midnight to midnight in UTC', () => {
    const instant = new Date('2026-11-20T20:15:00.500Z');

    expect(startOfLocalDay(instant, 'UTC')).toEqual(new Date('2026-11-20T00:00:00Z'));
    expect(endOfLocalDay(instant, 'UTC')).toEqual(new Date('2026-11-21T00:00:00Z'));
  });

  test('follow the zone on an ordinary day', () => {
    const instant = new Date('2026-07-10T12:00:00Z');

    expect(startOfLocalDay(instant, 'Europe/London')).toEqual(new Date('2026-07-09T23:00:00Z'));
    expect(endOfLocalDay(instant, 'Europe/London')).toEqual(new Date('2026-07-10T23:00:00Z'));
  });

  test('give a 25-hour day when the clocks go back', () => {
    // London leaves summer time at 01:00 UTC on 25 October 2026.
    const evening = new Date('2026-10-25T20:00:00Z');

    expect(startOfLocalDay(evening, 'Europe/London')).toEqual(new Date('2026-10-24T23:00:00Z'));
    expect(endOfLocalDay(evening, 'Europe/London')).toEqual(new Date('2026-10-26T00:00:00Z'));
  });

  test('give a 23-hour day when the clocks go forward', () => {
    // London enters summer time at 01:00 UTC on 29 March 2026.
    const evening = new Date('2026-03-29T20:00:00Z');

    expect(startOfLocalDay(evening, 'Europe/London')).toEqual(new Date('2026-03-29T00:00:00Z'));
    expect(endOfLocalDay(evening, 'Europe/London')).toEqual(new Date('2026-03-29T23:00:00Z'));
  });
});

import { describe, expect, test } from 'vitest';
import { PLAN_LENGTH_BANDS, lengthBand, planTable, type TableVideo } from '../src/plan/table';
import { SAME_AGE_MIN_DAYS, SAME_AGE_SHARE, viewsAtAge } from '../src/plan/sameAge';

const DAY_MS = 86_400_000;
const PUBLISHED = new Date('2026-11-01T00:00:00Z');
const afterDays = (days: number) => new Date(PUBLISHED.getTime() + days * DAY_MS);

describe('viewsAtAge', () => {
  const snapshots = [
    { capturedAt: afterDays(2), views: 500 },
    { capturedAt: afterDays(9), views: 4000 },
    { capturedAt: afterDays(20), views: 9000 },
  ];

  test('takes the reading closest to the age asked, within the stated window', () => {
    expect(SAME_AGE_MIN_DAYS).toBe(1);
    expect(SAME_AGE_SHARE).toBe(0.25);
    expect(viewsAtAge(snapshots, PUBLISHED, 'day', 10)).toEqual({
      status: 'comparable',
      ageDays: 9,
      views: 4000,
    });
  });

  test('says no reading was taken near that age when none falls in the window', () => {
    expect(viewsAtAge(snapshots, PUBLISHED, 'day', 5)).toEqual({
      status: 'not-comparable',
      reason: 'no-reading-near-age',
    });
    expect(viewsAtAge([], PUBLISHED, 'day', 5)).toEqual({
      status: 'not-comparable',
      reason: 'no-reading-near-age',
    });
  });

  test('says the upload date is too rough when its uncertainty is wider than the window', () => {
    expect(viewsAtAge(snapshots, PUBLISHED, 'month', 10)).toEqual({
      status: 'not-comparable',
      reason: 'date-too-rough',
    });
    expect(viewsAtAge(snapshots, PUBLISHED, 'week', 20)).toEqual({
      status: 'comparable',
      ageDays: 20,
      views: 9000,
    });
  });
});

describe('lengthBand', () => {
  test('puts a length in a stated band, and says when it is not known', () => {
    expect(PLAN_LENGTH_BANDS.map((band) => band.label)).toEqual([
      'Under 1 minute',
      '1 to 8 minutes',
      '8 to 15 minutes',
      '15 to 25 minutes',
      '25 minutes or more',
    ]);
    expect(lengthBand(45)).toBe('Under 1 minute');
    expect(lengthBand(60)).toBe('1 to 8 minutes');
    expect(lengthBand(14 * 60)).toBe('8 to 15 minutes');
    expect(lengthBand(40 * 60)).toBe('25 minutes or more');
    expect(lengthBand(null)).toBe('Length not known');
  });
});

describe('planTable', () => {
  const video = (overrides: Partial<TableVideo>): TableVideo => ({
    format: 'The {subject} nobody talks about',
    hookStyle: 'A question',
    durationSeconds: 600,
    score: 2,
    ...overrides,
  });

  test('counts each format, hook style and length, with the median score of those scored', () => {
    const rows = planTable([
      video({ score: 1 }),
      video({ score: 3 }),
      video({ format: null, hookStyle: null, durationSeconds: 30, score: null }),
    ]);

    expect(rows).toEqual([
      {
        kind: 'format',
        label: 'The {subject} nobody talks about',
        videos: 2,
        scored: 2,
        medianScore: 2,
      },
      { kind: 'format', label: 'No title format picked', videos: 1, scored: 0, medianScore: null },
      { kind: 'hook', label: 'A question', videos: 2, scored: 2, medianScore: 2 },
      { kind: 'hook', label: 'No hook style named', videos: 1, scored: 0, medianScore: null },
      { kind: 'length', label: '8 to 15 minutes', videos: 2, scored: 2, medianScore: 2 },
      { kind: 'length', label: 'Under 1 minute', videos: 1, scored: 0, medianScore: null },
    ]);
  });

  test('is empty with no linked videos', () => {
    expect(planTable([])).toEqual([]);
  });
});

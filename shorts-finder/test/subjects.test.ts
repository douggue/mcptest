import { describe, expect, test } from 'vitest';
import type { Subject } from '../src/repos/types';
import { SUBJECT_COST_UNITS, isDue, pickDueSubjects, type DueSearch } from '../src/subjects/due';
import {
  FULL_PAGE,
  NEWEST_MAX_LOOKBACK_HOURS,
  NEWEST_MIN_INTERVAL_HOURS,
  TOP_RECENT_WINDOW_HOURS,
  nextNewestInterval,
  publishedAfterFor,
} from '../src/subjects/sweep';
import {
  DEFAULT_EVERY_HOURS,
  DEFAULT_NEWEST_EVERY_HOURS,
  MAX_EVERY_HOURS,
  createSubject,
  expandAcrossRegions,
} from '../src/subjects/subject';
import { HOUR_MS, NOW, at } from './fixtures/facts';

function subject(id: number, overrides: Partial<Subject> = {}): Subject {
  return {
    id,
    keyword: 'night sky',
    region: 'CA',
    language: 'en',
    everyHours: 24,
    newestEveryHours: 24,
    enabled: true,
    lastSearchedAt: null,
    // Swept a moment ago unless a test says otherwise, so only the top-recent search is in play.
    newestIntervalHours: 24,
    newestLastAt: NOW,
    newestSweptTo: NOW,
    ...overrides,
  };
}

const ids = (searches: readonly DueSearch[]): number[] => searches.map((entry) => entry.subject.id);
const named = (searches: readonly DueSearch[]): string[] =>
  searches.map((entry) => `${entry.subject.id}:${entry.kind}`);

describe('createSubject', () => {
  test('tidies the keyword and the country, and fills in what was left out', () => {
    const made = createSubject({ keyword: '  sourdough starter ', region: ' gb ' });

    expect(made).toEqual({
      keyword: 'sourdough starter',
      region: 'GB',
      language: null,
      everyHours: DEFAULT_EVERY_HOURS,
      newestEveryHours: DEFAULT_NEWEST_EVERY_HOURS,
    });
    expect(DEFAULT_EVERY_HOURS).toBe(24);
    expect(DEFAULT_NEWEST_EVERY_HOURS).toBe(24);
  });

  test('keeps a language and a rhythm that were given', () => {
    const made = createSubject({
      keyword: 'reparar una bicicleta',
      region: 'MX',
      language: 'es',
      everyHours: 72,
      newestEveryHours: 12,
    });

    expect(made).toMatchObject({ language: 'es', everyHours: 72, newestEveryHours: 12 });
  });

  test('accepts a keyword of exactly 200 characters and a rhythm at either end', () => {
    expect(createSubject({ keyword: 'x'.repeat(200), region: 'US' }).keyword).toHaveLength(200);
    expect(createSubject({ keyword: 'k', region: 'US', everyHours: 1 }).everyHours).toBe(1);
    expect(
      createSubject({ keyword: 'k', region: 'US', everyHours: MAX_EVERY_HOURS }).everyHours,
    ).toBe(720);
  });

  test.each([
    ['an empty keyword', { keyword: '   ', region: 'US' }, /keyword must not be empty/],
    ['a keyword that is too long', { keyword: 'x'.repeat(201), region: 'US' }, /at most 200/],
    ['a country that is not two letters', { keyword: 'k', region: 'USA' }, /two-letter code/],
    ['a language that is not a code', { keyword: 'k', region: 'US', language: 'english' }, /code/],
    ['a rhythm of no hours', { keyword: 'k', region: 'US', everyHours: 0 }, /at least 1/],
    ['a rhythm of part of an hour', { keyword: 'k', region: 'US', everyHours: 1.5 }, /whole/],
    ['a rhythm beyond thirty days', { keyword: 'k', region: 'US', everyHours: 721 }, /at most/],
  ])('refuses %s', (_what, input, message) => {
    expect(() => createSubject(input)).toThrow(/Invalid subject\./);
    expect(() => createSubject(input)).toThrow(message);
  });

  test('names every fault at once', () => {
    expect(() => createSubject({ keyword: '', region: 'x' })).toThrow(/keyword.*country/);
  });
});

describe('expandAcrossRegions', () => {
  test('makes one subject for each country, alike in everything else', () => {
    const subjects = expandAcrossRegions('paper folding', ['US', 'GB', 'CA', 'AU'], {
      language: 'en',
      everyHours: 48,
    });

    expect(subjects.map((entry) => entry.region)).toEqual(['US', 'GB', 'CA', 'AU']);
    expect(subjects.every((entry) => entry.keyword === 'paper folding')).toBe(true);
    expect(subjects.every((entry) => entry.language === 'en' && entry.everyHours === 48)).toBe(
      true,
    );
  });

  test('lists a country named twice only once, and uses the defaults when given none', () => {
    const subjects = expandAcrossRegions('bicycle repair', ['au', 'AU', 'NZ']);

    expect(subjects).toEqual([
      {
        keyword: 'bicycle repair',
        region: 'AU',
        language: null,
        everyHours: 24,
        newestEveryHours: 24,
      },
      {
        keyword: 'bicycle repair',
        region: 'NZ',
        language: null,
        everyHours: 24,
        newestEveryHours: 24,
      },
    ]);
  });

  test('makes nothing for no countries, and refuses a bad one', () => {
    expect(expandAcrossRegions('night sky', [])).toEqual([]);
    expect(() => expandAcrossRegions('night sky', ['US', 'Canada'])).toThrow(/Invalid subject/);
  });
});

describe('pickDueSubjects', () => {
  const PLENTY = 6000;

  test('picks the never-searched first, then the longest unsearched', () => {
    const subjects = [
      subject(1, { lastSearchedAt: at(-30 * HOUR_MS) }),
      subject(2, { lastSearchedAt: at(-50 * HOUR_MS) }),
      subject(3),
      subject(4),
    ];

    expect(ids(pickDueSubjects(subjects, NOW, PLENTY))).toEqual([3, 4, 2, 1]);
  });

  test('leaves out what is switched off and what was searched within its hours', () => {
    const subjects = [
      subject(1, { enabled: false }),
      subject(2, { lastSearchedAt: at(-23 * HOUR_MS) }),
      subject(3, { lastSearchedAt: at(-24 * HOUR_MS) }),
      subject(4, { everyHours: 72, lastSearchedAt: at(-48 * HOUR_MS) }),
      subject(5, { everyHours: 6, lastSearchedAt: at(-7 * HOUR_MS) }),
    ];

    // The one due for an hour goes before the one that fell due this minute.
    expect(ids(pickDueSubjects(subjects, NOW, PLENTY))).toEqual([5, 3]);
  });

  test('counts a subject searched "after now" as due: the clock was set back', () => {
    const subjects = [subject(1, { lastSearchedAt: at(3 * HOUR_MS) })];

    expect(ids(pickDueSubjects(subjects, NOW, PLENTY))).toEqual([1]);
  });

  test('picks no more than the search share can still pay for', () => {
    const subjects = [1, 2, 3, 4].map((id) => subject(id));

    expect(SUBJECT_COST_UNITS).toBe(101);
    expect(ids(pickDueSubjects(subjects, NOW, 250))).toEqual([1, 2]);
    expect(ids(pickDueSubjects(subjects, NOW, 303))).toEqual([1, 2, 3]);
    expect(pickDueSubjects(subjects, NOW, 100)).toEqual([]);
    expect(pickDueSubjects(subjects, NOW, 0)).toEqual([]);
  });

  test('does not change the list it was given', () => {
    const subjects = [subject(2, { lastSearchedAt: at(-30 * HOUR_MS) }), subject(1)];

    pickDueSubjects(subjects, NOW, PLENTY);

    expect(subjects.map((entry) => entry.id)).toEqual([2, 1]);
  });

  test('chooses across both kinds of search, the longest-due first', () => {
    const subjects = [
      // Most-viewed due for 2 hours; newest due for 10.
      subject(1, { lastSearchedAt: at(-26 * HOUR_MS), newestLastAt: at(-34 * HOUR_MS) }),
      // Most-viewed due for 5 hours; newest swept an hour ago.
      subject(2, { lastSearchedAt: at(-29 * HOUR_MS), newestLastAt: at(-HOUR_MS) }),
      // Never searched either way.
      subject(3, { newestLastAt: null, newestSweptTo: null }),
    ];

    expect(named(pickDueSubjects(subjects, NOW, PLENTY))).toEqual([
      '3:top_recent',
      '3:newest',
      '1:newest',
      '2:top_recent',
      '1:top_recent',
    ]);
    expect(named(pickDueSubjects(subjects, NOW, 3 * SUBJECT_COST_UNITS))).toEqual([
      '3:top_recent',
      '3:newest',
      '1:newest',
    ]);
  });

  test('paces a newest sweep by the interval the subject is on, not the one it was set to', () => {
    const quick = subject(1, {
      lastSearchedAt: NOW,
      newestIntervalHours: 6,
      newestLastAt: at(-6 * HOUR_MS),
    });
    const usual = subject(2, { lastSearchedAt: NOW, newestLastAt: at(-6 * HOUR_MS) });

    expect(isDue(quick, 'newest', NOW)).toBe(true);
    expect(isDue(usual, 'newest', NOW)).toBe(false);
    expect(isDue(quick, 'top_recent', NOW)).toBe(false);
    expect(isDue({ ...quick, enabled: false }, 'newest', NOW)).toBe(false);
  });
});

describe('publishedAfterFor', () => {
  test('asks a top-recent search for the last 48 hours', () => {
    expect(publishedAfterFor(subject(1), 'top_recent', NOW)).toEqual(at(-48 * HOUR_MS));
    expect(TOP_RECENT_WINDOW_HOURS).toBe(48);
  });

  test('starts a newest sweep where the one before it ended', () => {
    const swept = subject(1, { newestSweptTo: at(-5 * HOUR_MS) });

    expect(publishedAfterFor(swept, 'newest', NOW)).toEqual(at(-5 * HOUR_MS));
  });

  test.each([
    ['a first sweep', null],
    ['a sweep long overdue', at(-90 * HOUR_MS)],
    ['a sweep that ended "after now"', at(HOUR_MS)],
  ])('looks back the named most for %s', (_what, newestSweptTo) => {
    const overdue = subject(1, { newestSweptTo });

    expect(publishedAfterFor(overdue, 'newest', NOW)).toEqual(at(-48 * HOUR_MS));
    expect(NEWEST_MAX_LOOKBACK_HOURS).toBe(48);
  });
});

describe('nextNewestInterval', () => {
  test('halves the interval when a sweep comes back full, down to the named floor', () => {
    expect(nextNewestInterval(24, 24, FULL_PAGE)).toBe(12);
    expect(nextNewestInterval(12, 24, FULL_PAGE)).toBe(6);
    expect(nextNewestInterval(4, 24, FULL_PAGE)).toBe(3);
    expect(nextNewestInterval(3, 24, FULL_PAGE)).toBe(3);
    expect(FULL_PAGE).toBe(50);
    expect(NEWEST_MIN_INTERVAL_HOURS).toBe(3);
  });

  test('lengthens it back towards the configured cadence when a sweep is under half full', () => {
    expect(nextNewestInterval(3, 24, 24)).toBe(6);
    expect(nextNewestInterval(6, 24, 0)).toBe(12);
    expect(nextNewestInterval(16, 24, 3)).toBe(24);
    expect(nextNewestInterval(24, 24, 3)).toBe(24);
  });

  test('leaves it alone when a sweep is between half full and full', () => {
    expect(nextNewestInterval(6, 24, 25)).toBe(6);
    expect(nextNewestInterval(6, 24, 49)).toBe(6);
  });

  test('never goes below a cadence the owner set under the floor, nor above the cadence', () => {
    expect(nextNewestInterval(2, 2, FULL_PAGE)).toBe(2);
    expect(nextNewestInterval(24, 12, 30)).toBe(12);
  });
});

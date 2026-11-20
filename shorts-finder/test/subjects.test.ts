import { describe, expect, test } from 'vitest';
import type { Subject } from '../src/repos/types';
import { SUBJECT_COST_UNITS, pickDueSubjects } from '../src/subjects/due';
import {
  DEFAULT_EVERY_HOURS,
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
    enabled: true,
    lastSearchedAt: null,
    ...overrides,
  };
}

const ids = (subjects: readonly Subject[]): number[] => subjects.map((entry) => entry.id);

describe('createSubject', () => {
  test('tidies the keyword and the country, and fills in what was left out', () => {
    const made = createSubject({ keyword: '  sourdough starter ', region: ' gb ' });

    expect(made).toEqual({
      keyword: 'sourdough starter',
      region: 'GB',
      language: null,
      everyHours: DEFAULT_EVERY_HOURS,
    });
    expect(DEFAULT_EVERY_HOURS).toBe(24);
  });

  test('keeps a language and a rhythm that were given', () => {
    const made = createSubject({
      keyword: 'reparar una bicicleta',
      region: 'MX',
      language: 'es',
      everyHours: 72,
    });

    expect(made).toMatchObject({ language: 'es', everyHours: 72 });
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
      { keyword: 'bicycle repair', region: 'AU', language: null, everyHours: 24 },
      { keyword: 'bicycle repair', region: 'NZ', language: null, everyHours: 24 },
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

    expect(ids(pickDueSubjects(subjects, NOW, PLENTY))).toEqual([3, 5]);
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

    expect(ids(subjects)).toEqual([2, 1]);
  });
});

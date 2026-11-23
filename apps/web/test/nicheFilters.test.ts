import type { MoneyStatus } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import {
  ageKeys,
  bestScore,
  countryKey,
  estimateMiddle,
  languageKey,
  revenueKey,
  sizeKey,
  tookOffKeys,
  uploadsKey,
  uploadsPerWeek,
} from '../src/lib/nicheBuckets';
import {
  FILTER_GROUPS,
  NO_FILTERS,
  activeCount,
  applyFilters,
  clearFilters,
  groupOptions,
  optionCounts,
  toggleChoice,
  uncheckedIds,
  withSort,
  type FilterContext,
} from '../src/lib/nicheFilters';
import { NICHE_SORTS, sortNiches } from '../src/lib/nicheSort';
import { parseSavedFilters, savedText } from '../src/lib/nicheFilterSave';
import { cid, niche, tookOff, worth } from './nicheFixture';

const NOW = new Date('2026-11-23T00:00:00Z');
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const contextWith = (money: Readonly<Record<string, MoneyStatus>> = {}): FilterContext => ({
  now: NOW,
  moneyOf: (id) => money[id] ?? 'not-checked',
});
const CONTEXT = contextWith();

describe('the buckets a channel falls in', () => {
  test('tells the alphabet of its titles, Latin when no other was found', () => {
    expect(languageKey(niche(1))).toBe('latin');
    expect(languageKey(niche(1, { otherLanguage: { script: 'Cyrillic' } }))).toBe('Cyrillic');
    expect(languageKey(niche(1, { otherLanguage: { script: null } }))).toBe('other');
  });

  test('puts its age from the first upload in one range', () => {
    expect(ageKeys(niche(1, { channelAgeDays: 20 }), NOW)).toEqual(['new']);
    expect(ageKeys(niche(1, { channelAgeDays: 120 }), NOW)).toEqual(['under-6m']);
    expect(ageKeys(niche(1, { channelAgeDays: 300 }), NOW)).toEqual(['under-1y']);
    expect(ageKeys(niche(1, { channelAgeDays: 900 }), NOW)).toEqual(['older']);
  });

  test('marks a channel that restarted on an older account', () => {
    const restarted = niche(1, { channelAgeDays: 40, createdAt: daysAgo(2000) });
    expect(ageKeys(restarted, NOW)).toEqual(['new', 'restarted']);
    const sameTime = niche(1, { channelAgeDays: 40, createdAt: daysAgo(70) });
    expect(ageKeys(sameTime, NOW)).toEqual(['new']);
  });

  test('falls back to the account date when the first upload is not known', () => {
    expect(ageKeys(niche(1, { channelAgeDays: null, createdAt: daysAgo(2000) }), NOW)).toEqual([
      'older',
    ]);
    expect(ageKeys(niche(1, { channelAgeDays: null, createdAt: 'not a date' }), NOW)).toEqual([
      'unknown',
    ]);
    expect(ageKeys(niche(1, { channelAgeDays: null }), NOW)).toEqual(['unknown']);
  });

  test('ranges the 30-day estimate by its middle, apart when there is nothing to estimate', () => {
    expect(estimateMiddle(worth(20, 80))).toBe(50);
    expect(revenueKey(niche(1, { earnings: worth(20, 80) }))).toBe('under-100');
    expect(revenueKey(niche(1, { earnings: worth(100, 400) }))).toBe('100-1k');
    expect(revenueKey(niche(1, { earnings: worth(1000, 4000) }))).toBe('1k-10k');
    expect(revenueKey(niche(1, { earnings: worth(8000, 32_000) }))).toBe('10k-plus');
    expect(revenueKey(niche(1, { earnings: worth(0, 0) }))).toBe('none');
  });

  test('ranges the subscribers, with a hidden count apart', () => {
    expect(sizeKey(niche(1, { subscribers: 500 }))).toBe('under-1k');
    expect(sizeKey(niche(1, { subscribers: 1000 }))).toBe('1k-10k');
    expect(sizeKey(niche(1, { subscribers: 10_000 }))).toBe('10k-100k');
    expect(sizeKey(niche(1, { subscribers: null }))).toBe('hidden');
  });

  test('takes the best multiple among the videos that took off', () => {
    const channel = niche(1, { outperformers: [tookOff(1, 6), tookOff(2, null), tookOff(3, 12)] });
    expect(bestScore(channel)).toBe(12);
    expect(tookOffKeys(channel)).toEqual(['5', '10']);
    expect(tookOffKeys(niche(1, { outperformers: [tookOff(1, 80)] }))).toEqual(['5', '10', '50']);
    expect(bestScore(niche(1))).toBeNull();
    expect(tookOffKeys(niche(1, { outperformers: [tookOff(1, 3)] }))).toEqual([]);
  });

  test('counts uploads a week from the last 30 days', () => {
    expect(uploadsPerWeek(niche(1, { recentUploads: 30 }))).toBe(7);
    expect(uploadsKey(niche(1, { recentUploads: 2 }))).toBe('under-1');
    expect(uploadsKey(niche(1, { recentUploads: 6 }))).toBe('1-3');
    expect(uploadsKey(niche(1, { recentUploads: 20 }))).toBe('3-7');
    expect(uploadsKey(niche(1, { recentUploads: 30 }))).toBe('7-plus');
  });

  test('keeps a well-formed country code and calls the rest unknown', () => {
    expect(countryKey(niche(1, { country: 'BR' }))).toBe('BR');
    expect(countryKey(niche(1, { country: 'ZZ' }))).toBe('unknown');
    expect(countryKey(niche(1, { country: 'brazil' }))).toBe('unknown');
    expect(countryKey(niche(1))).toBe('unknown');
  });
});

describe('applyFilters', () => {
  const channels = [
    niche(1, { otherLanguage: { script: 'Cyrillic' }, country: 'BG', subscribers: 500 }),
    niche(2, { channelAgeDays: 400, subscribers: 20_000 }),
    niche(3, { outperformers: [tookOff(3, 60)], earnings: worth(0, 0) }),
  ];

  test('keeps every channel in the order given when nothing is chosen', () => {
    expect(applyFilters(channels, NO_FILTERS, CONTEXT)).toEqual(channels);
  });

  test('keeps a channel in any chosen bucket of a group', () => {
    const state = toggleChoice(toggleChoice(NO_FILTERS, 'size', 'under-1k'), 'size', '10k-100k');
    expect(applyFilters(channels, state, CONTEXT).map((one) => one.id)).toEqual([cid(1), cid(2)]);
  });

  test('keeps only what passes every group chosen', () => {
    const state = toggleChoice(toggleChoice(NO_FILTERS, 'language', 'latin'), 'age', 'new');
    expect(applyFilters(channels, state, CONTEXT).map((one) => one.id)).toEqual([cid(3)]);
  });

  test('filters by the monetization verdict the page holds, unchecked included', () => {
    const context = contextWith({ [cid(2)]: 'monetized' });
    const monetized = toggleChoice(NO_FILTERS, 'money', 'monetized');
    expect(applyFilters(channels, monetized, context).map((one) => one.id)).toEqual([cid(2)]);
    const unchecked = toggleChoice(NO_FILTERS, 'money', 'not-checked');
    expect(applyFilters(channels, unchecked, context)).toHaveLength(2);
  });

  test('sorts what it keeps', () => {
    const state = withSort(NO_FILTERS, 'breakout');
    expect(applyFilters(channels, state, CONTEXT)[0]?.id).toBe(cid(3));
  });
});

describe('choosing filters', () => {
  test('toggles a bucket on and off without touching the state given', () => {
    const on = toggleChoice(NO_FILTERS, 'age', 'new');
    expect(on.chosen.age).toEqual(['new']);
    expect(NO_FILTERS.chosen.age).toEqual([]);
    expect(toggleChoice(on, 'age', 'new').chosen.age).toEqual([]);
  });

  test('keeps one threshold at most for took off', () => {
    const five = toggleChoice(NO_FILTERS, 'tookOff', '5');
    expect(toggleChoice(five, 'tookOff', '50').chosen.tookOff).toEqual(['50']);
    expect(toggleChoice(five, 'tookOff', '5').chosen.tookOff).toEqual([]);
  });

  test('counts the groups in use and clears them, keeping the sort', () => {
    const state = withSort(
      toggleChoice(toggleChoice(NO_FILTERS, 'age', 'new'), 'age', 'older'),
      'newest',
    );
    expect(activeCount(state)).toBe(1);
    expect(activeCount(toggleChoice(state, 'country', 'US'))).toBe(2);
    expect(clearFilters(state)).toEqual(withSort(NO_FILTERS, 'newest'));
  });
});

describe('the options a group offers', () => {
  const channels = [
    niche(1, { otherLanguage: { script: 'Cyrillic' }, country: 'BG' }),
    niche(2, { otherLanguage: { script: 'Cyrillic' } }),
    niche(3, { country: 'US' }),
    niche(4, { country: 'US', channelAgeDays: 400 }),
  ];

  test('offers the alphabets present, most common first, Latin named for what it covers', () => {
    const options = groupOptions(channels, 'language', CONTEXT);
    expect(options.map((option) => option.key)).toEqual(['latin', 'Cyrillic']);
    expect(options[0]?.label).toMatch(/Latin/);
  });

  test('offers the countries present by name, unknown last', () => {
    const options = groupOptions(channels, 'country', CONTEXT);
    expect(options.map((option) => option.key)).toEqual(['US', 'BG', 'unknown']);
    expect(options[0]?.label).toBe('United States');
    expect(options[2]?.label).toBe('Not known');
  });

  test('offers every fixed bucket, even an empty one', () => {
    const ages = groupOptions(channels, 'age', CONTEXT).map((option) => option.key);
    expect(ages).toEqual(['new', 'under-6m', 'under-1y', 'older', 'restarted', 'unknown']);
    expect(FILTER_GROUPS.map((group) => group.id)).toContain('revenue');
  });

  test('counts each option against the other groups chosen', () => {
    const usOnly = toggleChoice(NO_FILTERS, 'country', 'US');
    const ages = optionCounts(channels, usOnly, 'age', CONTEXT);
    expect(ages.get('new')).toBe(1);
    expect(ages.get('older')).toBe(1);
    // A group's own choice does not shrink its counts.
    expect(optionCounts(channels, usOnly, 'country', CONTEXT).get('BG')).toBe(1);
  });

  test('lists the channels not checked for money among those the other filters keep', () => {
    const context = contextWith({ [cid(3)]: 'likely' });
    const state = toggleChoice(toggleChoice(NO_FILTERS, 'country', 'US'), 'money', 'likely');
    expect(uncheckedIds(channels, state, context)).toEqual([cid(4)]);
  });
});

describe('sortNiches', () => {
  const channels = [
    niche(1, { recentViews: 10, viewsPerSubscriber: null, channelAgeDays: null }),
    niche(2, {
      recentViews: 30,
      viewsPerSubscriber: 5,
      channelAgeDays: 200,
      earnings: worth(1, 3),
    }),
    niche(3, {
      recentViews: 20,
      viewsPerSubscriber: 50,
      channelAgeDays: 10,
      outperformers: [tookOff(3, 9)],
    }),
  ];
  const ids = (sort: Parameters<typeof sortNiches>[1]) =>
    sortNiches(channels, sort, NOW).map((one) => Number(one.id.slice(-1)));

  test('keeps the stored order for most demand', () => {
    expect(ids('demand')).toEqual([1, 2, 3]);
    expect(NICHE_SORTS[0]?.id).toBe('demand');
  });

  test('sorts by breakout, views, views per subscriber, newest and estimate, unknowns last', () => {
    expect(ids('breakout')).toEqual([3, 1, 2]);
    expect(ids('views')).toEqual([2, 3, 1]);
    expect(ids('per-subscriber')).toEqual([3, 2, 1]);
    expect(ids('newest')).toEqual([3, 2, 1]);
    expect(ids('revenue')).toEqual([1, 3, 2]);
  });

  test('leaves the list it was given alone', () => {
    sortNiches(channels, 'views', NOW);
    expect(channels.map((one) => one.id)).toEqual([cid(1), cid(2), cid(3)]);
  });
});

describe('the filters kept in the browser', () => {
  test('round-trip through their saved text', () => {
    const state = withSort(toggleChoice(NO_FILTERS, 'language', 'Cyrillic'), 'newest');
    expect(parseSavedFilters(savedText(state))).toEqual(state);
  });

  test('start empty from nothing, broken text, or another shape', () => {
    expect(parseSavedFilters(null)).toEqual(NO_FILTERS);
    expect(parseSavedFilters('{not json')).toEqual(NO_FILTERS);
    expect(parseSavedFilters('[1,2]')).toEqual(NO_FILTERS);
    expect(parseSavedFilters('null')).toEqual(NO_FILTERS);
  });

  test('drop unknown buckets, sorts and odd values', () => {
    const raw = JSON.stringify({
      sort: 'loudest',
      chosen: {
        age: ['new', 'ancient', 3],
        country: ['US', 'x'.repeat(200)],
        tookOff: ['5', '10'],
        size: 'under-1k',
      },
    });
    const state = parseSavedFilters(raw);
    expect(state.sort).toBe('demand');
    expect(state.chosen.age).toEqual(['new']);
    expect(state.chosen.country).toEqual(['US']);
    expect(state.chosen.tookOff).toEqual(['5']);
    expect(state.chosen.size).toEqual([]);
  });
});

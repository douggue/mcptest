import type { BankCollection, BankVideo, BreakoutVideo } from '@jgtube/core';
import { NO_BANK_FILTERS } from '@jgtube/core/src/bank/query';
import { describe, expect, test } from 'vitest';
import { bankLookPath, toggleBankChoice } from '../src/lib/bank';
import { BREAKOUT_FILTERS, filterBreakouts } from '../src/lib/feed';
import {
  MAX_OWN_VIEWS,
  NO_MAP_FILTERS,
  OLD_BREAKOUT_FILTERS,
  SCORE_FLOORS,
  activeMapFilters,
  applyMapFilters,
  collectionKey,
  gridBankVideo,
  gridBreakout,
  ownKey,
  ownViewsText,
  parseOwnViews,
  viewNameProblem,
  viewPills,
  viewSlug,
  viewSource,
  type OwnView,
} from '../src/lib/videoViews';

const breakout = (videoId: string, score: number, subscribers: number | null, title = 'A title') =>
  ({
    videoId,
    title,
    views: 129_000,
    ageDays: 0.7,
    publishedRaw: '17h ago',
    durationSeconds: 1956,
    score,
    channelId: `UC${videoId.padEnd(22, 'x')}`,
    channelTitle: `Channel ${videoId}`,
    channelSubscribers: subscribers,
    baseline: 318,
    sampleSize: 38,
    channelHits: 4,
    channelScored: 30,
    channelAgeDays: null,
    caution: null,
  }) as BreakoutVideo;

/** A list like the map's: every mix of score and channel size, in the order the map gives it. */
const BREAKOUTS: readonly BreakoutVideo[] = [
  breakout('a', 542, 2500, 'Steel bridge record'),
  breakout('b', 268, 412_000, 'The end of steel'),
  breakout('c', 99.9, 9_999, 'Almost a hundred'),
  breakout('d', 100, 10_000, 'Exactly a hundred'),
  breakout('e', 50, null, 'Hidden size, fifty'),
  breakout('f', 49.9, 800, 'Small and under fifty'),
  breakout('g', 3, 35, 'Tiny channel'),
  breakout('h', 7.3, 1_100_000, 'Large channel'),
];

describe('the breakout views against the old Breaking out list', () => {
  test.each(BREAKOUT_FILTERS.map((option) => option.id))(
    'the view for the old "%s" filter keeps the same videos, in the same order',
    (old) => {
      const before = filterBreakouts(BREAKOUTS, old).map((item) => item.videoId);
      const now = applyMapFilters(BREAKOUTS, OLD_BREAKOUT_FILTERS[old]).map((item) => item.videoId);
      expect(now).toEqual(before);
    },
  );

  test('the three built-in views are the old list unfiltered, at 100× and on small channels', () => {
    const ids = (key: string): readonly string[] => {
      const source = viewSource(key, [], []);
      return source.kind === 'map'
        ? applyMapFilters(BREAKOUTS, source.filters).map((item) => item.videoId)
        : [];
    };
    expect(ids('')).toEqual(filterBreakouts(BREAKOUTS, 'all').map((item) => item.videoId));
    expect(ids('100x')).toEqual(filterBreakouts(BREAKOUTS, '100x').map((item) => item.videoId));
    expect(ids('small-channels')).toEqual(
      filterBreakouts(BREAKOUTS, 'small').map((item) => item.videoId),
    );
    expect(ids('')).toHaveLength(8);
    expect(ids('100x')).toEqual(['a', 'b', 'd']);
    expect(ids('small-channels')).toEqual(['a', 'c', 'f', 'g']);
  });

  test('the choices can be put together, which the old list could not', () => {
    const both = applyMapFilters(BREAKOUTS, { score: '50', small: true, words: '' });
    expect(both.map((item) => item.videoId)).toEqual(['a', 'c']);
    const worded = applyMapFilters(BREAKOUTS, { ...NO_MAP_FILTERS, words: '  STEEL  bridge ' });
    expect(worded.map((item) => item.videoId)).toEqual(['a']);
    expect(applyMapFilters(BREAKOUTS, { ...NO_MAP_FILTERS, words: 'steel' })).toHaveLength(2);
    expect(applyMapFilters([], NO_MAP_FILTERS)).toEqual([]);
  });

  test('counts the filters in use, and offers the old score floors', () => {
    expect(activeMapFilters(NO_MAP_FILTERS)).toBe(0);
    expect(activeMapFilters({ score: '100', small: true, words: ' x ' })).toBe(3);
    expect(SCORE_FLOORS.map((floor) => floor.id)).toEqual(['any', '50', '100']);
  });
});

describe('the bank views against the old Outlier bank', () => {
  const collections: readonly BankCollection[] = [
    { id: 3, name: 'Hooks to steal', count: 23, createdAt: '2026-11-01T00:00:00.000Z' },
  ];

  test('All-time bank asks the bank as the old list did: with its own remembered filters', () => {
    expect(viewSource('bank', collections, [])).toEqual({
      kind: 'bank',
      filters: null,
      collectionId: null,
      own: null,
    });
  });

  test('a collection’s view asks for exactly what choosing that collection in the old filters did', () => {
    const source = viewSource(collectionKey(3), collections, []);
    // The old list's collection row toggled the option the bank names `c<id>`.
    const old = toggleBankChoice(NO_BANK_FILTERS, 'collection', 'c3');
    expect(bankLookPath(old, 0, 24)).toBe('/api/bank?collection=c3&sort=score&offset=0&limit=24');
    expect(source.kind === 'bank' && source.filters && bankLookPath(source.filters, 0, 24)).toBe(
      bankLookPath(old, 0, 24),
    );
    expect(source).toMatchObject({ kind: 'bank', collectionId: 3 });
  });

  test('a collection that is not there is missing, once the collections are known', () => {
    expect(viewSource(collectionKey(9), collections, [])).toEqual({ kind: 'missing' });
    expect(viewSource(collectionKey(9), null, []).kind).toBe('bank');
  });
});

describe('the views row', () => {
  const own: readonly OwnView[] = [
    { name: 'Big and small', source: 'map', filters: { score: '50', small: true, words: '' } },
    { name: 'Rockets', source: 'bank', filters: { ...NO_BANK_FILTERS, contains: 'rocket' } },
  ];
  const collections: readonly BankCollection[] = [
    { id: 3, name: 'Space race', count: 23, createdAt: '2026-11-01T00:00:00.000Z' },
  ];

  test('lists the built-in views, the collections, the owner’s views and Studied, with counts', () => {
    const pills = viewPills({
      breakouts: BREAKOUTS,
      bankTotal: 1284,
      collections,
      own,
      transfers: 14,
      studied: 2,
    });
    expect(pills).toEqual([
      { key: '', label: 'Breaking out', count: '8' },
      { key: 'bank', label: 'All-time bank', count: '1,284' },
      { key: '100x', label: '100× and up', count: '3' },
      { key: 'small-channels', label: 'Small channels', count: '4' },
      { key: 'other-languages', label: 'Other languages', count: '14' },
      { key: 'collection/3', label: 'Space race', count: '23' },
      { key: 'saved/big-and-small', label: 'Big and small' },
      { key: 'saved/rockets', label: 'Rockets' },
      { key: 'studied', label: 'Studied', count: '2' },
    ]);
  });

  test('leaves a count out until it is known', () => {
    const pills = viewPills({
      breakouts: null,
      bankTotal: null,
      collections: [],
      own: [],
      transfers: null,
      studied: null,
    });
    expect(pills.every((pill) => pill.count === undefined)).toBe(true);
    expect(pills.map((pill) => pill.key)).toEqual([
      '',
      'bank',
      '100x',
      'small-channels',
      'other-languages',
      'studied',
    ]);
  });

  test('opens each view on its source', () => {
    expect(viewSource('other-languages', [], [])).toEqual({ kind: 'transfers' });
    expect(viewSource('studied', [], [])).toEqual({ kind: 'studied' });
    expect(viewSource(ownKey(own[0]!), [], own)).toEqual({
      kind: 'map',
      filters: { score: '50', small: true, words: '' },
      own: own[0],
    });
    expect(viewSource(ownKey(own[1]!), [], own)).toMatchObject({
      kind: 'bank',
      collectionId: null,
      own: own[1],
    });
    expect(viewSource('saved/gone', [], own)).toEqual({ kind: 'missing' });
    expect(viewSource('nonsense', [], own)).toEqual({ kind: 'missing' });
  });
});

describe('the views the owner saves', () => {
  const views: readonly OwnView[] = [
    { name: 'Big and small', source: 'map', filters: { score: '50', small: true, words: 'x' } },
    {
      name: 'Rockets',
      source: 'bank',
      filters: toggleBankChoice({ ...NO_BANK_FILTERS, contains: 'rocket' }, 'score', '10'),
    },
  ];

  test('are kept in this browser and read back the same', () => {
    expect(parseOwnViews(ownViewsText(views))).toEqual(views);
    expect(parseOwnViews(ownViewsText([]))).toEqual([]);
  });

  test('are read back with every field checked, and none when unreadable', () => {
    expect(parseOwnViews(null)).toEqual([]);
    expect(parseOwnViews('not json')).toEqual([]);
    expect(parseOwnViews('{"a":1}')).toEqual([]);
    const messy = JSON.stringify([
      { name: 'Kept', source: 'map', filters: { score: '999', small: 'yes', words: 7 } },
      { name: 'Also kept', source: 'map' },
      { name: 'Bank', source: 'bank', filters: 42 },
      { name: '', source: 'map' },
      { name: 'x'.repeat(41), source: 'map' },
      { name: 'Other source', source: 'web' },
      { source: 'map' },
      null,
      'text',
    ]);
    expect(parseOwnViews(messy)).toEqual([
      { name: 'Kept', source: 'map', filters: NO_MAP_FILTERS },
      { name: 'Also kept', source: 'map', filters: NO_MAP_FILTERS },
      { name: 'Bank', source: 'bank', filters: NO_BANK_FILTERS },
    ]);
    const many = Array.from({ length: MAX_OWN_VIEWS + 3 }, (_, index) => ({
      name: `View ${index}`,
      source: 'map',
    }));
    expect(parseOwnViews(JSON.stringify(many))).toHaveLength(MAX_OWN_VIEWS);
  });

  test('need a name of their own', () => {
    expect(viewNameProblem('  ', views)).toBe('Give the view a name.');
    expect(viewNameProblem('x'.repeat(41), views)).toBe('A name can be at most 40 characters.');
    expect(viewNameProblem('BIG and  small', views)).toBe('You already have a view of that name.');
    expect(viewNameProblem('New one', views)).toBeNull();
    const full = Array.from({ length: MAX_OWN_VIEWS }, (_, index) => ({
      ...views[0]!,
      name: `View ${index}`,
    }));
    expect(viewNameProblem('One more', full)).toBe('You can keep 12 views. Remove one first.');
  });

  test('have an address made from their name', () => {
    expect(viewSlug('Big & small!')).toBe('big-small');
    expect(viewSlug('***')).toBe('view');
    expect(ownKey(views[1]!)).toBe('saved/rockets');
    expect(collectionKey(3)).toBe('collection/3');
  });
});

describe('a card of the grid', () => {
  test('shows a breakout with its score and what the score rests on', () => {
    expect(gridBreakout(BREAKOUTS[0]!)).toEqual({
      videoId: 'a',
      title: 'Steel bridge record',
      channelId: 'UCaxxxxxxxxxxxxxxxxxxxxx',
      channelTitle: 'Channel a',
      channelLogoUrl: null,
      durationSeconds: 1956,
      score: '542×',
      meta: '129K views · 17h ago',
      why: 'Usually 318 views · compared with 38 videos · 4 of 30 recent videos broke out',
    });
  });

  test('shows a stored video the same way, scored or not', () => {
    const video = {
      videoId: 'dQw4w9WgXcQ',
      title: 'A title',
      views: 941_000,
      ageDays: 8,
      durationSeconds: 2205,
      score: 269,
      baseline: 3500,
      sampleSize: 30,
      caution: null,
      channel: { id: 'UC0UJp3kmO7wf33XFf56gbTw', title: 'A channel', logoUrl: 'https://x/l.jpg' },
    } as BankVideo;
    expect(gridBankVideo(video)).toEqual({
      videoId: 'dQw4w9WgXcQ',
      title: 'A title',
      channelId: 'UC0UJp3kmO7wf33XFf56gbTw',
      channelTitle: 'A channel',
      channelLogoUrl: 'https://x/l.jpg',
      durationSeconds: 2205,
      score: '269×',
      meta: '941K views · 8 days ago',
      why: 'Its views over its channel’s usual 3.5K views at the same age, from 30 other videos.',
    });
    expect(gridBankVideo({ ...video, score: null, baseline: null }).score).toBeNull();
  });
});

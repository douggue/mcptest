import { describe, expect, test } from 'vitest';
import { BANK_GROUPS, optionLabel } from '../src/bank/filters';
import {
  BANK_MAX_PAGE,
  NO_BANK_FILTERS,
  bankQueryParams,
  parseBankQuery,
  queryBank,
  withChoice,
} from '../src/bank/query';
import type { BankChannel, BankVideo } from '../src/bank/types';

const channel = (over: Partial<BankChannel> = {}): BankChannel => ({
  id: `UC${'A'.repeat(22)}`,
  title: 'Channel A',
  handle: null,
  subscribers: 5000,
  logoUrl: null,
  country: 'US',
  topic: { label: 'Science & space', source: 'titles' },
  alphabet: 'latin',
  money: 'monetized',
  closeness: null,
  onAMap: true,
  ...over,
});

const video = (id: string, over: Partial<BankVideo> = {}): BankVideo => ({
  videoId: id.padEnd(11, 'x'),
  title: `Video ${id}`,
  views: 50_000,
  ageDays: 10,
  publishedAt: '2026-11-10T00:00:00.000Z',
  publishedRaw: '10d ago',
  durationSeconds: 600,
  isShort: false,
  score: 12,
  baseline: 1000,
  sampleSize: 10,
  caution: null,
  viewsPerDay: 5000,
  readAt: '2026-11-20T00:00:00.000Z',
  channel: channel(),
  ...over,
});

const BANK: readonly BankVideo[] = [
  video('a', { score: 120, title: 'Rocket engine from scrap' }),
  video('b', { score: 6, views: 2_000_000, ageDays: 200, viewsPerDay: 10_000 }),
  video('c', { score: null, views: 300, title: 'Rocket fails' }),
  video('d', {
    score: 3,
    isShort: true,
    durationSeconds: 40,
    ageDays: 2,
    publishedAt: '2026-11-18T00:00:00.000Z',
    channel: channel({ alphabet: 'Cyrillic', country: null, onAMap: false, money: 'not-checked' }),
  }),
];

const context = {
  collectionsOf: (videoId: string) => (videoId.startsWith('b') ? [4] : []),
  collectionNames: new Map([[4, 'Hooks to steal']]),
};

describe('querying the bank', () => {
  test('with no filters it shows everything, highest score first, unscored last', () => {
    const page = queryBank(BANK, NO_BANK_FILTERS, context);
    expect(page.total).toBe(4);
    expect(page.matched).toBe(4);
    expect(page.videos.map((v) => v.videoId[0])).toEqual(['a', 'b', 'd', 'c']);
  });

  test('a lowest score keeps every video at or above it and never an unscored one', () => {
    const page = queryBank(BANK, withChoice(NO_BANK_FILTERS, 'score', ['10']), context);
    expect(page.videos.map((v) => v.videoId[0])).toEqual(['a']);
    const counts = page.options.score;
    expect(counts.find((o) => o.key === '5')?.count).toBe(2);
    expect(counts.find((o) => o.key === '100')?.count).toBe(1);
  });

  test('groups combine; options count what they would keep given the other groups', () => {
    const state = withChoice(withChoice(NO_BANK_FILTERS, 'length', ['shorts']), 'source', [
      'elsewhere',
    ]);
    const page = queryBank(BANK, state, context);
    expect(page.matched).toBe(1);
    expect(page.options.length.find((o) => o.key === '8-20')?.count).toBe(0);
    expect(page.options.language.map((o) => o.key)).toEqual(['latin', 'Cyrillic']);
    expect(page.options.country.find((o) => o.key === 'unknown')?.label).toBe('Not known');
  });

  test('title words: contains needs every word, excludes drops any', () => {
    const contains = queryBank(BANK, { ...NO_BANK_FILTERS, contains: 'rocket' }, context);
    expect(contains.videos.map((v) => v.videoId[0])).toEqual(['a', 'c']);
    const both = queryBank(
      BANK,
      { ...NO_BANK_FILTERS, contains: 'ROCKET', excludes: 'fails' },
      context,
    );
    expect(both.videos.map((v) => v.videoId[0])).toEqual(['a']);
  });

  test('collections filter and label by the owner’s names', () => {
    const page = queryBank(BANK, withChoice(NO_BANK_FILTERS, 'collection', ['c4']), context);
    expect(page.videos.map((v) => v.videoId[0])).toEqual(['b']);
    expect(page.options.collection).toEqual([{ key: 'c4', label: 'Hooks to steal', count: 1 }]);
  });

  test('sorts by views, newest and views a day', () => {
    const ids = (sort: 'views' | 'newest' | 'pace') =>
      queryBank(BANK, { ...NO_BANK_FILTERS, sort }, context).videos.map((v) => v.videoId[0]);
    expect(ids('views')[0]).toBe('b');
    expect(ids('newest')[0]).toBe('d');
    expect(ids('pace')[0]).toBe('b');
  });

  test('pages are capped', () => {
    const page = queryBank(BANK, NO_BANK_FILTERS, context, { offset: 1, limit: 2 });
    expect(page.videos).toHaveLength(2);
    expect(page.offset).toBe(1);
    expect(queryBank(BANK, NO_BANK_FILTERS, context, { offset: 0, limit: 10_000 }).limit).toBe(
      BANK_MAX_PAGE,
    );
  });
});

describe('the query in an address', () => {
  test('goes there and back', () => {
    const state = {
      ...withChoice(withChoice(NO_BANK_FILTERS, 'score', ['50']), 'topic', ['Gaming', 'History']),
      contains: 'how',
      excludes: 'clip',
      sort: 'pace' as const,
    };
    const params = bankQueryParams(state);
    expect(parseBankQuery(new URLSearchParams(params))).toEqual(state);
  });

  test('drops what the page could not have written', () => {
    const parsed = parseBankQuery(
      new URLSearchParams('score=7,10&views=lots&sort=random&topic=' + 'x'.repeat(80)),
    );
    expect(parsed.chosen.score).toEqual(['10']);
    expect(parsed.chosen.views).toEqual([]);
    expect(parsed.chosen.topic).toEqual([]);
    expect(parsed.sort).toBe('score');
  });

  test('every group has a label and a note', () => {
    expect(BANK_GROUPS.every((g) => g.label !== '' && g.note !== '')).toBe(true);
    expect(optionLabel('language', 'latin', context)).toBe('Latin letters');
    expect(optionLabel('country', 'FR', context)).toBe('France');
    expect(optionLabel('collection', 'c9', context)).toBe('A collection');
    expect(optionLabel('views', 'zzz', context)).toBe('zzz');
  });
});

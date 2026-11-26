import { describe, expect, test } from 'vitest';
import {
  BANK_FILTERS_KEY,
  activeBankFilters,
  bankLookPath,
  clearBankFilters,
  closenessText,
  costLine,
  createBankApi,
  exportHref,
  parseSavedBank,
  savedBankText,
  toggleBankChoice,
  videoMeta,
} from '../src/lib/bank';
import { NO_BANK_FILTERS } from '@jgtube/core/src/bank/query';
import { routeFromHash } from '../src/lib/routes';
import { whereOf } from '../src/lib/places';

const NOW = new Date('2026-11-20T12:00:00Z');

describe('the outlier bank’s filters on the page', () => {
  test('toggle like New niches: many in a group, one at a time where single', () => {
    const two = toggleBankChoice(
      toggleBankChoice(NO_BANK_FILTERS, 'length', 'shorts'),
      'length',
      '8-20',
    );
    expect(two.chosen.length).toEqual(['shorts', '8-20']);
    expect(toggleBankChoice(two, 'length', 'shorts').chosen.length).toEqual(['8-20']);
    const score = toggleBankChoice(toggleBankChoice(NO_BANK_FILTERS, 'score', '5'), 'score', '50');
    expect(score.chosen.score).toEqual(['50']);
    expect(toggleBankChoice(score, 'score', '50').chosen.score).toEqual([]);
    expect(activeBankFilters({ ...two, contains: 'how' })).toBe(2);
    expect(clearBankFilters({ ...two, sort: 'views' })).toEqual({
      ...NO_BANK_FILTERS,
      sort: 'views',
    });
  });

  test('are remembered in the browser and read back through the same checks', () => {
    expect(BANK_FILTERS_KEY).toBe('jgtube.bankFilters.v1');
    const state = { ...toggleBankChoice(NO_BANK_FILTERS, 'topic', 'Cars'), excludes: 'clip' };
    expect(parseSavedBank(savedBankText(state))).toEqual(state);
    expect(parseSavedBank(null)).toEqual(NO_BANK_FILTERS);
    expect(parseSavedBank('{nope')).toEqual(NO_BANK_FILTERS);
    expect(parseSavedBank('[1]')).toEqual(NO_BANK_FILTERS);
  });

  test('become the address the page reads a page of the bank from', () => {
    const path = bankLookPath(toggleBankChoice(NO_BANK_FILTERS, 'score', '10'), 24, 24);
    expect(path).toBe('/api/bank?score=10&sort=score&offset=24&limit=24');
    expect(bankLookPath(NO_BANK_FILTERS, 0, 12, 'UC0UJp3kmO7wf33XFf56gbTw')).toBe(
      '/api/bank?sort=score&channel=UC0UJp3kmO7wf33XFf56gbTw&offset=0&limit=12',
    );
  });
});

describe('what a card says', () => {
  test('views, age and length on one line', () => {
    expect(
      videoMeta({ views: 1_234_000, ageDays: 40.2, durationSeconds: 754, isShort: false }),
    ).toBe('1.2M views · 5 weeks · 12:34');
    expect(videoMeta({ views: 900, ageDays: 0.3, durationSeconds: 40, isShort: true })).toBe(
      '900 views · under a day · Short',
    );
    expect(videoMeta({ views: 5, ageDays: 3, durationSeconds: null, isShort: false })).toBe(
      '5 views · 3 days',
    );
  });

  test('how close the channel is to one of the owner’s', () => {
    expect(closenessText(null)).toBeNull();
    expect(closenessText({ centerId: 'x', centerTitle: 'Mine', tier: 'close' })).toBe(
      'Close to Mine',
    );
  });

  test('what a find will cost, before it starts', () => {
    expect(
      costLine({
        via: 'pages',
        plan: { via: 'pages', channels: 10, requests: 51, apiUnits: 0 },
        allowance: { via: 'pages', cap: 400, used: 60, left: 340 },
        topics: [],
      }),
    ).toBe('Up to 51 page requests, signed out, at the usual pace. 340 of today’s 400 left.');
    expect(
      costLine({
        via: 'api',
        plan: { via: 'api', channels: 10, requests: 42, apiUnits: 141 },
        allowance: { via: 'api', cap: 1500, used: 0, left: 1500 },
        topics: [],
      }),
    ).toBe('Up to 141 units of your API key (42 requests). 1,500 of today’s 1,500 left.');
  });

  test('export links name the collection and the kind', () => {
    expect(exportHref(4, 'csv')).toBe('/api/bank/collections/export?id=4&as=csv');
  });
});

describe('the bank api', () => {
  test('reads, starts a find and changes collections with JSON writes', async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const api = createBankApi(async (path, init) => {
      calls.push({ path: String(path), ...(init ? { init } : {}) });
      return new Response(
        JSON.stringify({
          success: true,
          data: { ok: 1, jobId: 'j', collections: [] },
          error: null,
        }),
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    await api.look(NO_BANK_FILTERS, 0, 24);
    await api.findInfo(5);
    expect(await api.startFind('rockets', 5)).toBe('j');
    await api.createCollection('Hooks');
    await api.addToCollection(1, 'abcdefghijk');
    await api.removeFromCollection(1, 'abcdefghijk');
    await api.deleteCollection(1);
    await api.job('j');
    expect(calls.map((call) => call.path)).toEqual([
      '/api/bank?sort=score&offset=0&limit=24',
      '/api/bank/find?channels=5',
      '/api/bank/find',
      '/api/bank/collections/create',
      '/api/bank/collections/add',
      '/api/bank/collections/remove',
      '/api/bank/collections/delete',
      '/api/jobs/j',
    ]);
    expect(calls[2]?.init?.body).toBe(JSON.stringify({ query: 'rockets', channels: 5 }));
  });
});

describe('where the bank sits', () => {
  test('is a saved view of Discover › Videos right after Breaking out, at its own address', () => {
    const videos = whereOf('outlier-bank');
    expect([videos?.place.id, videos?.tab.label]).toEqual(['discover', 'Videos']);
    expect(videos?.tab.screens.slice(0, 2).map((screen) => screen.view)).toEqual([
      'breakouts',
      'outlier-bank',
    ]);
    expect(routeFromHash('#/discover/videos/bank').view).toBe('outlier-bank');
    expect(routeFromHash('#/outlier-bank').view).toBe('outlier-bank');
    expect(NOW).toBeInstanceOf(Date);
  });
});

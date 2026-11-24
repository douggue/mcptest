import type { SweepInfo, SweepRunView } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import {
  budgetLine,
  budgetOptions,
  costLine,
  createSweepApi,
  foundByText,
  newNichesLine,
  onlyNew,
  scheduleOptions,
  summaryRows,
  sweptText,
  sweepHeadline,
} from '../src/lib/sweep';
import { niche } from './nicheFixture';

const NOW = new Date('2026-11-20T12:00:00Z');

const info = (overrides: Partial<SweepInfo> = {}): SweepInfo => ({
  via: 'pages',
  keywords: [],
  maxKeywords: 50,
  suggestions: [],
  settings: { everyDays: null, pageBudget: 400 },
  budget: { pages: { cap: 400, used: 60, left: 340 }, units: null },
  plan: { via: 'pages', keywords: 3, keywordsCovered: 3, most: { pages: 248, units: 0 } },
  last: null,
  restingUntil: null,
  cannotStart: null,
  ...overrides,
});

const run = (overrides: Partial<SweepRunView> = {}): SweepRunView => ({
  id: 4,
  startedBy: 'owner',
  via: 'pages',
  startedAt: '2026-11-20T09:00:00.000Z',
  finishedAt: '2026-11-20T09:04:00.000Z',
  stopped: 'done',
  message: null,
  requests: 73,
  apiUnits: 0,
  summary: {
    keywords: [
      {
        keywordId: 1,
        keyword: 'lost cities',
        channelsFound: 14,
        channelsRead: 9,
        alreadyKnown: 1,
        failed: 0,
        qualified: 2,
        requests: 46,
        apiUnits: 0,
      },
    ],
    snowball: {
      sources: 2,
      sidebarsRead: 4,
      channelsRead: 3,
      failed: 0,
      qualified: 1,
      requests: 23,
      apiUnits: 0,
    },
    newNiches: 3,
    keywordsLeft: 0,
    problems: [],
  },
  ...overrides,
});

describe('what a sweep will cost, said first', () => {
  test('in page requests, with how many keywords today’s budget covers', () => {
    expect(costLine(info())).toBe(
      'Up to 248 page requests for 3 keywords, signed out, at the usual pace.',
    );
    expect(
      costLine(
        info({
          plan: { via: 'pages', keywords: 12, keywordsCovered: 5, most: { pages: 340, units: 0 } },
        }),
      ),
    ).toBe(
      'Up to 340 page requests, signed out, at the usual pace. Today’s budget covers about 5 of 12 keywords; the rest wait for the next sweep.',
    );
    expect(
      costLine(
        info({
          via: 'api',
          plan: { via: 'api', keywords: 1, keywordsCovered: 1, most: { pages: 20, units: 225 } },
        }),
      ),
    ).toBe('Up to 225 units of your API key and 20 page requests for 1 keyword.');
    expect(costLine(info({ plan: { ...info().plan, keywords: 0, keywordsCovered: 0 } }))).toBe(
      'Add a keyword to see what a sweep would read.',
    );
  });

  test('the budget line says what is used and left today', () => {
    expect(budgetLine(info())).toBe('60 of 400 page requests used today · 340 left');
    expect(
      budgetLine(
        info({
          budget: {
            pages: { cap: 400, used: 0, left: 400 },
            units: { cap: 1500, used: 300, left: 1200 },
          },
        }),
      ),
    ).toBe('0 of 400 page requests used today · 400 left · API units: 300 of 1,500 used');
  });

  test('the budget choices run from the least to five times the default and hold the saved one', () => {
    const choices = budgetOptions(400);
    expect(choices[0]).toBe(100);
    expect(choices.at(-1)).toBe(2000);
    expect(choices).toContain(400);
    expect(budgetOptions(450)).toContain(450);
  });

  test('the schedule is off, daily or every few days, and holds the saved one', () => {
    expect(scheduleOptions(null).map((one) => one.label)).toEqual([
      'Off',
      'Every day',
      'Every 2 days',
      'Every 3 days',
      'Every 7 days',
      'Every 14 days',
      'Every 30 days',
    ]);
    expect(scheduleOptions(5).map((one) => one.value)).toContain('5');
    expect(scheduleOptions(null)[0]?.value).toBe('off');
  });
});

describe('what the page says about a sweep', () => {
  test('when a keyword was last swept', () => {
    expect(sweptText(null, NOW)).toBe('Not swept yet');
    expect(sweptText('2026-11-20T11:30:00Z', NOW)).toBe('Swept today');
    expect(sweptText('2026-11-19T10:00:00Z', NOW)).toBe('Swept yesterday');
    expect(sweptText('2026-11-10T10:00:00Z', NOW)).toBe('Swept 10 days ago');
  });

  test('the last sweep in one line, and each keyword as a row', () => {
    expect(sweepHeadline(run())).toBe('Last sweep: 3 new niche channels found · 73 page requests');
    expect(
      sweepHeadline(run({ stopped: 'budget', message: 'Today’s reading budget is used.' })),
    ).toBe(
      'Last sweep: 3 new niche channels found · 73 page requests · Today’s reading budget is used.',
    );
    expect(sweepHeadline(run({ via: 'api', apiUnits: 140, requests: 8 }))).toBe(
      'Last sweep: 3 new niche channels found · 140 API units and 8 page requests',
    );
    expect(sweepHeadline(run({ summary: null, finishedAt: null, stopped: null }))).toBe(
      'The last sweep was cut off before it finished.',
    );
    expect(summaryRows(run())).toEqual([
      { name: 'lost cities', read: 9, qualified: 2, requests: '46 requests' },
      { name: 'Snowball from 2 new niches', read: 3, qualified: 1, requests: '23 requests' },
    ]);
    expect(summaryRows(run({ summary: null }))).toEqual([]);
  });

  test('how a channel was found', () => {
    expect(foundByText({ kind: 'keyword', keyword: 'lost cities' })).toBe('Found by “lost cities”');
    expect(foundByText({ kind: 'snowball', fromChannelId: 'UCx', fromTitle: 'Atlas' })).toBe(
      'Found by snowball from Atlas',
    );
    expect(foundByText({ kind: 'snowball', fromChannelId: 'UCx', fromTitle: null })).toBe(
      'Found by snowball from a new niche',
    );
    expect(foundByText({ kind: 'map' })).toBe('Found by your map');
    expect(foundByText(null)).toBeNull();
  });

  test('new since the last sweep: the filter and the line other views show', () => {
    const channels = [
      niche(1, { newSinceSweep: true }),
      niche(2),
      niche(3, { newSinceSweep: true }),
    ];
    expect(onlyNew(channels, true).map((one) => one.id)).toEqual([
      channels[0]?.id,
      channels[2]?.id,
    ]);
    expect(onlyNew(channels, false)).toHaveLength(3);
    expect(newNichesLine(1)).toBe('1 new niche channel found');
    expect(newNichesLine(4)).toBe('4 new niche channels found');
    expect(newNichesLine(0)).toBeNull();
  });
});

describe('the sweep’s part of the API', () => {
  test('reads the watchlist, changes it, saves the settings and starts a sweep', async () => {
    const calls: { path: string; body?: unknown }[] = [];
    const api = createSweepApi(async (path, init) => {
      calls.push({
        path: String(path),
        ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}),
      });
      return new Response(
        JSON.stringify({
          success: true,
          data: { ...info(), jobId: 'j1', started: true },
          error: null,
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    expect((await api.info()).settings.pageBudget).toBe(400);
    await api.addKeyword('lost cities');
    await api.changeKeyword('pause', 3);
    await api.saveSettings({ everyDays: 2, pageBudget: 800 });
    expect(await api.start()).toBe('j1');
    await api.job('j 1');
    expect(calls).toEqual([
      { path: '/api/niches/sweep' },
      { path: '/api/niches/sweep/keywords', body: { action: 'add', keyword: 'lost cities' } },
      { path: '/api/niches/sweep/keywords', body: { action: 'pause', id: 3 } },
      { path: '/api/niches/sweep/settings', body: { everyDays: 2, pageBudget: 800 } },
      { path: '/api/niches/sweep', body: {} },
      { path: '/api/jobs/j%201' },
    ]);
  });
});

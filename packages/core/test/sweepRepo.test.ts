import { describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { SqliteSweepRepo } from '../src/repos/sqliteSweepRepo';
import { READING_BUDGET_DEFAULT } from '../src/sweep/budget';
import type { SweepSummary } from '../src/sweep/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);
const cid = (letter: string) => `UC${letter.repeat(22)}`;

const SUMMARY: SweepSummary = {
  keywords: [],
  snowball: {
    sources: 0,
    sidebarsRead: 0,
    channelsRead: 0,
    failed: 0,
    qualified: 0,
    requests: 0,
    apiUnits: 0,
  },
  newNiches: 0,
  keywordsLeft: 0,
  problems: [],
};

const open = () => new SqliteSweepRepo(openDatabase(':memory:'));

describe('the watchlist', () => {
  test('keeps keywords once whatever their case, in the order added', () => {
    const repo = open();
    const first = repo.addKeyword('lost cities', NOW);
    expect(first).toMatchObject({ keyword: 'lost cities', paused: false, lastSweptAt: null });
    expect(repo.addKeyword('Lost Cities', NOW)).toBeNull();
    repo.addKeyword('deep sea', later(1));
    expect(repo.keywords().map((one) => one.keyword)).toEqual(['lost cities', 'deep sea']);
  });

  test('pauses, marks as swept and removes a keyword', () => {
    const repo = open();
    const kept = repo.addKeyword('lost cities', NOW);
    const id = kept?.id ?? 0;
    expect(repo.setPaused(id, true)).toBe(true);
    expect(repo.keywords()[0]?.paused).toBe(true);
    repo.markSwept(id, later(2));
    expect(repo.keywords()[0]?.lastSweptAt).toEqual(later(2));
    expect(repo.setPaused(999, true)).toBe(false);
    expect(repo.removeKeyword(id)).toBe(true);
    expect(repo.removeKeyword(id)).toBe(false);
    expect(repo.keywords()).toEqual([]);
  });
});

describe('the sweep settings', () => {
  test('are off and at the default budget until saved', () => {
    const repo = open();
    expect(repo.settings()).toEqual({ everyDays: null, pageBudget: READING_BUDGET_DEFAULT });
    repo.saveSettings({ everyDays: 3, pageBudget: 900 });
    repo.saveSettings({ everyDays: 1, pageBudget: 1200 });
    expect(repo.settings()).toEqual({ everyDays: 1, pageBudget: 1200 });
  });
});

describe('sweeps as stored', () => {
  test('a sweep is written as it goes, then finished with its summary', () => {
    const repo = open();
    expect(repo.latest()).toBeNull();
    const id = repo.begin({ startedBy: 'owner', via: 'pages', startedAt: NOW });
    repo.spend(id, { pages: 26, units: 0 });
    expect(repo.latest()).toMatchObject({ id, requests: 26, stopped: null, finishedAt: null });
    expect(repo.spentSince(later(-1))).toEqual({ pages: 26, units: 0 });
    expect(repo.spentSince(later(1))).toEqual({ pages: 0, units: 0 });
    repo.finish(id, { stopped: 'budget', message: 'Stopped', summary: SUMMARY, finishedAt: later(1) });
    expect(repo.latest()).toMatchObject({
      stopped: 'budget',
      message: 'Stopped',
      summary: SUMMARY,
      finishedAt: later(1),
    });
    const second = repo.begin({ startedBy: 'schedule', via: 'api', startedAt: later(2) });
    repo.spend(second, { pages: 4, units: 120 });
    expect(repo.spentSince(later(-1))).toEqual({ pages: 30, units: 120 });
    expect(repo.list(5).map((one) => one.id)).toEqual([second, id]);
  });

  test('a channel is found once, by the first sweep that brought it', () => {
    const repo = open();
    const keyword = repo.addKeyword('lost cities', NOW);
    const first = repo.begin({ startedBy: 'owner', via: 'pages', startedAt: NOW });
    const second = repo.begin({ startedBy: 'owner', via: 'pages', startedAt: later(30) });
    const find = {
      channelId: cid('A'),
      sweepId: first,
      source: 'keyword' as const,
      keywordId: keyword?.id ?? null,
      keyword: 'lost cities',
      fromChannelId: null,
      qualified: true,
      foundAt: NOW,
    };
    repo.recordFind(find);
    repo.recordFind({ ...find, sweepId: second, qualified: false, foundAt: later(30) });
    repo.recordFind({
      ...find,
      channelId: cid('B'),
      sweepId: second,
      source: 'snowball',
      keywordId: null,
      keyword: null,
      fromChannelId: cid('A'),
      foundAt: later(30),
    });
    expect(repo.finds().get(cid('A'))).toEqual(find);
    expect(repo.finds().get(cid('B'))).toMatchObject({ source: 'snowball', fromChannelId: cid('A') });
    expect(repo.keywords()[0]?.found).toBe(1);
    expect(repo.qualifiedSince(later(-1))).toBe(2);
    expect(repo.qualifiedSince(later(1))).toBe(1);
  });
});

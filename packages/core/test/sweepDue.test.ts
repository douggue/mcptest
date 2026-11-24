import { describe, expect, test } from 'vitest';
import { refusalRestUntil, sweepDue } from '../src/sweep/due';
import { suggestKeywords } from '../src/sweep/suggest';
import type { StoredSweep, SweepStop } from '../src/sweep/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

function sweep(stopped: SweepStop | null, startedHoursAgo: number): StoredSweep {
  return {
    id: 1,
    startedBy: 'schedule',
    via: 'pages',
    requests: 0,
    apiUnits: 0,
    startedAt: ago(startedHoursAgo),
    finishedAt: stopped === null ? null : ago(startedHoursAgo - 0.5),
    stopped,
    message: null,
    summary: null,
  };
}

const daily = { everyDays: 1, pageBudget: 400 };
const weekly = { everyDays: 7, pageBudget: 400 };

describe('when a scheduled sweep is due', () => {
  test('never with the schedule off, at once when nothing was swept yet', () => {
    expect(sweepDue({ everyDays: null, pageBudget: 400 }, null, NOW)).toBe(false);
    expect(sweepDue(daily, null, NOW)).toBe(true);
  });

  test('a daily turn comes after twenty hours, an every-N-days turn a day short of N days', () => {
    expect(sweepDue(daily, sweep('done', 19), NOW)).toBe(false);
    expect(sweepDue(daily, sweep('done', 20), NOW)).toBe(true);
    expect(sweepDue(weekly, sweep('done', 6 * 24 + 19), NOW)).toBe(false);
    expect(sweepDue(weekly, sweep('done', 6 * 24 + 20), NOW)).toBe(true);
  });

  test('a sweep that stopped at the budget, or was cut off, resumes the next day whatever the schedule', () => {
    expect(sweepDue(weekly, sweep('budget', 19), NOW)).toBe(false);
    expect(sweepDue(weekly, sweep('budget', 21), NOW)).toBe(true);
    expect(sweepDue(weekly, sweep(null, 21), NOW)).toBe(true);
  });

  test('after a refusal nothing is swept for a day', () => {
    const refused = sweep('refused', 10);
    expect(refusalRestUntil(refused, NOW)).toEqual(ago(9.5 - 24));
    expect(sweepDue(daily, refused, NOW)).toBe(false);
    expect(refusalRestUntil(sweep('refused', 30), NOW)).toBeNull();
    expect(sweepDue(daily, sweep('refused', 30), NOW)).toBe(true);
    expect(refusalRestUntil(sweep('done', 1), NOW)).toBeNull();
    expect(refusalRestUntil(null, NOW)).toBeNull();
  });
});

describe('keywords suggested from the owner’s maps', () => {
  const channel = (topic: string, winners: readonly string[], others: readonly string[]) => ({
    topic,
    videos: [
      ...winners.map((title) => ({ title, score: 8 })),
      ...others.map((title) => ({ title, score: 1 })),
    ],
  });
  const channels = [
    channel('History', ['The lost city under the lake', 'A buried fortress'], ['Weekly update']),
    channel('History', ['Lost fortress of the north'], ['Weekly update two', 'A fortress tour']),
    channel('Science & space', ['Why the lake glows'], ['Weekly news']),
    channel('Other', [], ['Weekly chat']),
  ];

  test('are the maps’ topic labels and the words winners share across channels', () => {
    const found = suggestKeywords({ channels, kept: [] });
    expect(found.slice(0, 2)).toEqual([
      { keyword: 'History', from: 'topic', channels: 2 },
      { keyword: 'Science space', from: 'topic', channels: 1 },
    ]);
    const words = found.filter((one) => one.from === 'titles');
    // "lost" and "lake" are in winners of two channels; "fortress" too but also in a non-winner.
    expect(words.map((one) => one.keyword)).toEqual(['lake', 'lost', 'fortress']);
    expect(words.every((one) => one.channels === 2)).toBe(true);
  });

  test('leave out what the watchlist already holds, and words of one channel only', () => {
    const found = suggestKeywords({ channels, kept: ['HISTORY', 'lost'] });
    expect(found.map((one) => one.keyword)).toEqual(['Science space', 'lake', 'fortress']);
    expect(found.some((one) => one.keyword === 'buried')).toBe(false);
  });

  test('nothing from an empty store', () => {
    expect(suggestKeywords({ channels: [], kept: [] })).toEqual([]);
  });
});

import { describe, expect, test } from 'vitest';
import {
  CALENDAR_MIN_WEEKS,
  CALENDAR_MAX_WEEKS,
  buildWeeks,
  isPlannedDate,
  weekStart,
  type CalendarItem,
} from '../src/calendar/calendar';
import { winnersPace } from '../src/calendar/pace';
import type { ChannelHistory } from '../src/changes/changes';
import type { StoredVideo } from '../src/repos/types';

const NOW = new Date('2026-11-21T12:00:00Z'); // a Saturday
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const item = (conceptId: number, plannedDate: string | null): CalendarItem => ({
  conceptId,
  title: `Concept ${conceptId}`,
  status: 'idea',
  plannedDate,
  hasScript: false,
  linkedVideoId: null,
});

describe('dates', () => {
  test('reads only a real calendar date written as YYYY-MM-DD', () => {
    expect(isPlannedDate('2026-11-30')).toBe(true);
    expect(isPlannedDate('2026-02-30')).toBe(false);
    expect(isPlannedDate('30/11/2026')).toBe(false);
  });

  test('gives the Monday a week starts on', () => {
    expect(weekStart('2026-11-21')).toBe('2026-11-16');
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
  });
});

describe('buildWeeks', () => {
  test('lays weeks from this one onwards, each with what is planned, and marks gaps against the pace', () => {
    const { weeks, undated, earlier } = buildWeeks(
      [item(1, '2026-11-24'), item(2, '2026-11-26'), item(3, null), item(4, '2026-11-02')],
      '2026-11-21',
      1.5,
    );

    expect(CALENDAR_MIN_WEEKS).toBe(8);
    expect(weeks).toHaveLength(CALENDAR_MIN_WEEKS);
    expect(weeks[0]).toMatchObject({ start: '2026-11-16', planned: 0, gap: true });
    expect(weeks[1]).toMatchObject({ start: '2026-11-23', planned: 2, gap: false });
    expect(weeks[1]?.items.map((entry) => entry.conceptId)).toEqual([1, 2]);
    expect(weeks[2]).toMatchObject({ start: '2026-11-30', planned: 0, gap: true });
    expect(undated.map((entry) => entry.conceptId)).toEqual([3]);
    expect(earlier.map((entry) => entry.conceptId)).toEqual([4]);
  });

  test('reaches the last planned week, up to a stated limit, and marks no gaps with no pace', () => {
    const { weeks, later } = buildWeeks(
      [item(1, '2027-01-25'), item(2, '2028-01-01')],
      '2026-11-21',
      null,
    );

    expect(weeks.at(-1)?.start).toBe('2027-01-25');
    expect(weeks.every((week) => week.gap === false)).toBe(true);
    expect(weeks.length).toBeLessThanOrEqual(CALENDAR_MAX_WEEKS);
    expect(later.map((entry) => entry.conceptId)).toEqual([2]);
  });
});

describe('winnersPace', () => {
  const video = (channel: string, n: number, days: number, views: number): StoredVideo => ({
    id: `${channel}${n}`.padEnd(11, '_'),
    channelId: `UC${channel.repeat(22)}`,
    title: 'T',
    views,
    durationSeconds: 600,
    published: { date: daysAgo(days), precision: 'day', raw: `${days}d ago` },
    fetchedAt: NOW,
  });
  const channel = (letter: string, videos: readonly StoredVideo[]): ChannelHistory => ({
    channel: {
      id: `UC${letter.repeat(22)}`,
      title: letter,
      handle: null,
      subscribers: 1000,
      subscribersHidden: false,
      videoCount: null,
      fetchedAt: NOW,
    },
    videos,
    readings: [],
  });
  /** Three uploads far above the channel's size in the last two weeks, plus `extra` more: taken off. */
  const winner = (letter: string, extra: number) =>
    channel(letter, [
      ...[1, 2, 3].map((n) => video(letter, n, 6 + n, 60_000)),
      ...Array.from({ length: extra }, (_, n) => video(letter, 10 + n, 2 + n, 60_000)),
      ...[1, 2, 3, 4].map((n) => video(letter, 20 + n, 40 + n * 5, 1000)),
    ]);

  test('gives the median uploads a week of the look-alikes that took off, as the map counts them', () => {
    const pace = winnersPace(
      [winner('a', 0), winner('b', 2), channel('q', [video('q', 1, 5, 10)])],
      NOW,
    );

    expect(pace).toEqual({ channels: 2, medianPerWeek: (1.5 + 2.5) / 2 });
  });

  test('has no pace when no look-alike has taken off', () => {
    expect(winnersPace([channel('q', [video('q', 1, 5, 10)])], NOW)).toEqual({
      channels: 0,
      medianPerWeek: null,
    });
  });
});

import type { CalendarView, CalendarWeek } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { STATUS_LABELS, paceLine, weekLabel, weekNote } from '../src/lib/calendar';
import { createExtrasApi } from '../src/lib/extrasApi';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const pace = { channels: 3, medianPerWeek: 2.5, windowDays: 14 };
const week = (planned: number, gap: boolean): CalendarWeek => ({
  start: '2026-11-23',
  items: [],
  planned,
  gap,
});

describe('the calendar wording', () => {
  test('names the four statuses', () => {
    expect(STATUS_LABELS).toEqual({
      idea: 'Idea',
      drafting: 'Drafting',
      ready: 'Ready',
      published: 'Published',
    });
  });

  test('names a week by its Monday, and this week as this week', () => {
    expect(weekLabel('2026-11-23', '2026-11-21')).toBe('Week of Mon 23 Nov');
    expect(weekLabel('2026-11-16', '2026-11-21')).toBe('This week (from Mon 16 Nov)');
  });

  test("says the winners' pace with what it rests on, or that there is none", () => {
    expect(paceLine(pace)).toBe(
      'The 3 channels like yours that took off on this map upload a median of 2.5 videos a week (counted over the last 14 days). A comparison, not a target.',
    );
    expect(paceLine({ ...pace, channels: 1, medianPerWeek: 1 })).toContain(
      'The 1 channel like yours that took off on this map uploads 1 video a week',
    );
    expect(paceLine({ channels: 0, medianPerWeek: null, windowDays: 14 })).toBe(
      'No channel like yours has taken off on this map, so there is no pace to compare with.',
    );
  });

  test('says what a week holds against the pace', () => {
    expect(weekNote(week(3, false), pace)).toBe('3 planned');
    expect(weekNote(week(1, true), pace)).toBe('1 planned · fewer than the winners’ 2.5 a week');
    expect(weekNote(week(0, true), pace)).toBe(
      'Nothing planned · fewer than the winners’ 2.5 a week',
    );
    expect(weekNote(week(0, false), { ...pace, medianPerWeek: null })).toBe('Nothing planned');
  });
});

describe('the calendar API', () => {
  const view: CalendarView = {
    centerChannelId: CHANNEL,
    today: '2026-11-21',
    pace,
    weeks: [],
    undated: [],
    earlier: [],
    later: [],
  };

  test('reads a calendar and saves an item', async () => {
    const sent: string[] = [];
    const api = createExtrasApi(async (url, init) => {
      sent.push(`${init?.method ?? 'GET'} ${String(url)} ${String(init?.body ?? '')}`.trim());
      return new Response(JSON.stringify({ success: true, data: view, error: null }));
    });

    await expect(api.calendar(CHANNEL)).resolves.toEqual(view);
    await expect(
      api.saveCalendarItem(CHANNEL, 2, { status: 'ready', plannedDate: null }),
    ).resolves.toEqual(view);
    expect(sent).toEqual([
      `GET /api/calendar?channel=${CHANNEL}`,
      `POST /api/calendar/item {"channel":"${CHANNEL}","conceptId":2,"status":"ready","plannedDate":null}`,
    ]);
  });
});

import type { CalendarView } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { localDate } from '../src/calendarEngine';
import type { ExtrasEngine } from '../src/extrasTypes';
import { JobStore } from '../src/jobs';
import { CHANNEL_ID, HOST, get, post, read, stubEngine, withExtras } from './support';

const appWith = (parts: Partial<ExtrasEngine>) =>
  createApp({ engine: stubEngine(withExtras(parts)), jobs: new JobStore(), allowedHosts: [HOST] });

const view: CalendarView = {
  centerChannelId: CHANNEL_ID,
  today: '2026-11-21',
  pace: { channels: 0, medianPerWeek: null, windowDays: 14 },
  weeks: [],
  undated: [],
  earlier: [],
  later: [],
};
const body = { channel: CHANNEL_ID, conceptId: 2, status: 'ready', plannedDate: '2026-11-25' };

describe('localDate', () => {
  test("gives the computer's own calendar date", () => {
    expect(localDate(new Date(2026, 10, 3, 23, 30))).toBe('2026-11-03');
  });
});

describe('GET /api/calendar', () => {
  test("answers the channel's calendar, 404 with no map, 400 for a bad channel", async () => {
    const found = await get(
      appWith({ findCalendar: () => view }),
      `/api/calendar?channel=${CHANNEL_ID}`,
    );
    expect((await read<CalendarView>(found)).data).toEqual(view);
    expect(
      (await get(appWith({ findCalendar: () => null }), `/api/calendar?channel=${CHANNEL_ID}`))
        .status,
    ).toBe(404);
    expect((await get(appWith({}), '/api/calendar?channel=x')).status).toBe(400);
  });
});

describe('POST /api/calendar/item', () => {
  test('saves a status and date and answers the calendar', async () => {
    const saved: unknown[] = [];
    const app = appWith({
      saveCalendarItem: (...args) => {
        saved.push(args);
        return { outcome: 'saved', calendar: view };
      },
    });

    expect((await post(app, '/api/calendar/item', body)).status).toBe(200);
    await post(app, '/api/calendar/item', { ...body, status: null, plannedDate: null });
    expect(saved).toEqual([
      [CHANNEL_ID, 2, { status: 'ready', plannedDate: '2026-11-25' }],
      [CHANNEL_ID, 2, { status: null, plannedDate: null }],
    ]);
  });

  test.each([
    ['no-concept', 404, 'There is no kept concept with that number for this channel.'],
    ['bad-date', 400, 'Give the date as a real day, YYYY-MM-DD.'],
    ['no-map', 404, 'No map has been made for this channel yet'],
  ] as const)('answers %s with %i and a plain reason', async (outcome, status, message) => {
    const app = appWith({ saveCalendarItem: () => ({ outcome, calendar: null }) });

    const response = await post(app, '/api/calendar/item', body);

    expect(response.status).toBe(status);
    expect((await read(response)).error).toBe(message);
  });

  test('passes the same checks as every other write', async () => {
    const app = appWith({ saveCalendarItem: () => ({ outcome: 'saved', calendar: view }) });

    expect((await post(app, '/api/calendar/item', { ...body, status: 'done' })).status).toBe(400);
    expect(
      (await post(app, '/api/calendar/item', { ...body, plannedDate: '25/11/2026' })).status,
    ).toBe(400);
    expect(
      (await post(app, '/api/calendar/item', body, { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect(
      (await post(app, '/api/calendar/item', body, { 'content-type': 'text/plain' })).status,
    ).toBe(415);
    expect((await get(app, '/api/calendar/item')).status).toBe(405);
  });
});

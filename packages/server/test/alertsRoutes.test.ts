import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import type { AlertsReply } from '../src/alertsTypes';
import type { ExtrasEngine } from '../src/extrasTypes';
import { JobStore } from '../src/jobs';
import { CHANNEL_ID, HOST, get, post, read, stubEngine, withExtras } from './support';

const appWith = (parts: Partial<ExtrasEngine>) =>
  createApp({ engine: stubEngine(withExtras(parts)), jobs: new JobStore(), allowedHosts: [HOST] });

const reply: AlertsReply = {
  centerChannelId: CHANNEL_ID,
  rule: null,
  defaultMinScore: 5,
  minMinScore: 2,
  maxMinScore: 100,
  alerts: [],
  unread: 0,
  lastRefreshAt: null,
};
const rule = { channel: CHANNEL_ID, minScore: 6.5, takenOff: false, enabled: true };

describe('GET /api/alerts', () => {
  test("answers a channel's rule and alerts", async () => {
    const app = appWith({ findAlerts: () => reply });

    const response = await get(app, `/api/alerts?channel=${CHANNEL_ID}`);

    expect(response.status).toBe(200);
    expect((await read<AlertsReply>(response)).data).toEqual(reply);
  });

  test('refuses a channel that is not a channel id, and answers 404 with no map', async () => {
    expect((await get(appWith({}), '/api/alerts?channel=@x')).status).toBe(400);
    expect(
      (await get(appWith({ findAlerts: () => null }), `/api/alerts?channel=${CHANNEL_ID}`)).status,
    ).toBe(404);
  });

  test('answers only to its own address', async () => {
    const app = appWith({ findAlerts: () => reply });

    expect((await get(app, `/api/alerts?channel=${CHANNEL_ID}`, 'evil.example')).status).toBe(403);
  });
});

describe('GET /api/alerts/counts', () => {
  test('answers the unread count of each channel', async () => {
    const app = appWith({ alertCounts: () => ({ [CHANNEL_ID]: 3 }) });

    const response = await get(app, '/api/alerts/counts');

    expect((await read<{ counts: Record<string, number> }>(response)).data).toEqual({
      counts: { [CHANNEL_ID]: 3 },
    });
  });
});

describe('POST /api/alerts/rule', () => {
  test('saves the rule and answers the channel with it', async () => {
    const saved: unknown[] = [];
    const app = appWith({
      saveAlertRule: (channel, settings) => {
        saved.push([channel, settings]);
        return reply;
      },
    });

    const response = await post(app, '/api/alerts/rule', rule);

    expect(response.status).toBe(200);
    expect(saved).toEqual([[CHANNEL_ID, { minScore: 6.5, takenOff: false, enabled: true }]]);
  });

  test('refuses a number outside the stated range, and a body that is not a rule', async () => {
    const app = appWith({ saveAlertRule: () => reply });

    expect((await post(app, '/api/alerts/rule', { ...rule, minScore: 1.5 })).status).toBe(400);
    expect((await post(app, '/api/alerts/rule', { ...rule, minScore: 101 })).status).toBe(400);
    expect((await post(app, '/api/alerts/rule', { ...rule, enabled: 'yes' })).status).toBe(400);
    expect((await post(app, '/api/alerts/rule', '{not json')).status).toBe(400);
  });

  test('answers 404 with no map, and passes the same checks as every other write', async () => {
    expect(
      (await post(appWith({ saveAlertRule: () => null }), '/api/alerts/rule', rule)).status,
    ).toBe(404);
    const app = appWith({ saveAlertRule: () => reply });
    expect(
      (await post(app, '/api/alerts/rule', rule, { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect(
      (await post(app, '/api/alerts/rule', rule, { 'content-type': 'text/plain' })).status,
    ).toBe(415);
    expect((await get(app, '/api/alerts/rule')).status).toBe(405);
  });
});

describe('POST /api/alerts/read', () => {
  test("marks a channel's alerts read", async () => {
    const app = appWith({ markAlertsRead: () => reply });

    expect((await post(app, '/api/alerts/read', { channel: CHANNEL_ID })).status).toBe(200);
    expect((await post(app, '/api/alerts/read', { channel: 'nope' })).status).toBe(400);
    expect(
      (
        await post(appWith({ markAlertsRead: () => null }), '/api/alerts/read', {
          channel: CHANNEL_ID,
        })
      ).status,
    ).toBe(404);
  });
});

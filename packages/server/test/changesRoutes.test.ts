import type { ChangesView } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import type { ChangesReply, ExtrasEngine } from '../src/extrasTypes';
import { JobStore } from '../src/jobs';
import { CHANNEL_ID, HOST, get, post, read, stubEngine, withExtras } from './support';

const appWith = (parts: Partial<ExtrasEngine>) =>
  createApp({ engine: stubEngine(withExtras(parts)), jobs: new JobStore(), allowedHosts: [HOST] });

const view: ChangesView = {
  centerChannelId: CHANNEL_ID,
  since: '2026-11-14T12:00:00.000Z',
  now: '2026-11-21T12:00:00.000Z',
  changes: {
    comparedChannels: 0,
    uncomparedChannels: 0,
    newBreakouts: [],
    newBreakoutCount: 0,
    groups: { takenOff: [], rising: [], droppedOut: [] },
    formats: [],
  },
  lookalikes: { comparable: false, reason: 'same-map' },
  freshness: { channels: 0, oldestReadAt: null, newestReadAt: null, lastRefreshAt: null },
};
const reply: ChangesReply = {
  ...view,
  asked: 'last-look',
  sinceKind: 'week',
  lastLookAt: null,
  newNiches: 0,
};

describe('GET /api/changes', () => {
  test('answers what changed for a channel, since the last look unless told otherwise', async () => {
    const asked: unknown[] = [];
    const app = appWith({
      findChanges: (channel, kind) => {
        asked.push([channel, kind]);
        return reply;
      },
    });

    const usual = await get(app, `/api/changes?channel=${CHANNEL_ID}`);
    await get(app, `/api/changes?channel=${CHANNEL_ID}&since=yesterday`);

    expect(usual.status).toBe(200);
    expect((await read<ChangesReply>(usual)).data).toEqual(reply);
    expect(asked).toEqual([
      [CHANNEL_ID, 'last-look'],
      [CHANNEL_ID, 'yesterday'],
    ]);
  });

  test('refuses a channel that is not a channel id and a moment it does not know', async () => {
    const app = appWith({});

    expect((await get(app, '/api/changes?channel=@somebody')).status).toBe(400);
    expect((await get(app, `/api/changes?channel=${CHANNEL_ID}&since=forever`)).status).toBe(400);
  });

  test('answers 404 for a channel with no map', async () => {
    const app = appWith({ findChanges: () => null });

    expect((await get(app, `/api/changes?channel=${CHANNEL_ID}`)).status).toBe(404);
  });

  test('answers only to its own address', async () => {
    const app = appWith({ findChanges: () => reply });

    expect((await get(app, `/api/changes?channel=${CHANNEL_ID}`, 'evil.example')).status).toBe(403);
  });

  test('takes only GET', async () => {
    expect((await post(appWith({}), '/api/changes', { channel: CHANNEL_ID })).status).toBe(405);
  });
});

describe('POST /api/changes/seen', () => {
  test('moves the last look forward and says when it now is', async () => {
    const app = appWith({ markChangesSeen: () => '2026-11-21T12:00:00.000Z' });

    const response = await post(app, '/api/changes/seen', { channel: CHANNEL_ID });

    expect(response.status).toBe(200);
    expect((await read<{ lastLookAt: string }>(response)).data).toEqual({
      lastLookAt: '2026-11-21T12:00:00.000Z',
    });
  });

  test('answers 404 for a channel with no map', async () => {
    const app = appWith({ markChangesSeen: () => null });

    expect((await post(app, '/api/changes/seen', { channel: CHANNEL_ID })).status).toBe(404);
  });

  test('passes the same checks as every other write', async () => {
    const app = appWith({ markChangesSeen: () => 'x' });
    const body = { channel: CHANNEL_ID };

    expect((await post(app, '/api/changes/seen', { channel: 'nope' })).status).toBe(400);
    expect((await post(app, '/api/changes/seen', '{not json')).status).toBe(400);
    expect(
      (await post(app, '/api/changes/seen', body, { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect(
      (await post(app, '/api/changes/seen', body, { 'content-type': 'text/plain' })).status,
    ).toBe(415);
    expect((await get(app, '/api/changes/seen')).status).toBe(405);
  });
});

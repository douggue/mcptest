import { describe, expect, test } from 'vitest';
import { createApp, type Engine } from '../src/app';
import { JobStore } from '../src/jobs';
import type { StyleLockView } from '../src/styleLockEngine';
import { CHANNEL_ID, HOST, get, post, read, stubEngine } from './support';

const FROM = `UC${'d'.repeat(22)}`;
const view: StyleLockView = {
  channelId: CHANNEL_ID,
  from: { id: FROM, title: 'Model' },
  text: 'STYLE BLOCK: Ink.',
  writtenAt: '2026-11-21T12:00:00.000Z',
};
const appWith = (parts: Partial<Engine>) =>
  createApp({ engine: stubEngine(parts), jobs: new JobStore(), allowedHosts: [HOST] });

describe('the style lock over HTTP', () => {
  test('reads the lock kept for a channel, or none', async () => {
    const app = appWith({ findStyleLock: (channel) => (channel === CHANNEL_ID ? view : null) });

    expect((await read(await get(app, `/api/style-lock?channel=${CHANNEL_ID}`))).data).toEqual({
      lock: view,
    });
    expect((await read(await get(app, `/api/style-lock?channel=${FROM}`))).data).toEqual({
      lock: null,
    });
    expect((await get(app, '/api/style-lock?channel=nope')).status).toBe(400);
  });

  test('keeps a breakdown’s lock for the channel, and says why when it cannot', async () => {
    const used: unknown[] = [];
    const app = appWith({
      useStyleLock: (channel, from) => {
        used.push([channel, from]);
        if (from !== FROM) throw new Error('That channel’s breakdown has no style lock.');
        return view;
      },
    });

    const kept = await post(app, '/api/style-lock', { channel: CHANNEL_ID, from: FROM });
    const none = await post(app, '/api/style-lock', { channel: CHANNEL_ID, from: CHANNEL_ID });
    const bad = await post(app, '/api/style-lock', { channel: CHANNEL_ID });

    expect((await read(kept)).data).toEqual({ lock: view });
    expect(none.status).toBe(404);
    expect((await read(none)).error).toMatch(/no style lock/);
    expect(bad.status).toBe(400);
  });

  test('stops using a lock', async () => {
    const stopped: string[] = [];
    const app = appWith({ stopStyleLock: (channel) => void stopped.push(channel) });

    const reply = await post(app, '/api/style-lock/stop', { channel: CHANNEL_ID });

    expect(reply.status).toBe(200);
    expect(stopped).toEqual([CHANNEL_ID]);
  });
});

describe('GET /api/flow', () => {
  test('gives the counts for a channel with a map, and 404 without one', async () => {
    const counts = {
      breakouts: 4,
      formulas: 2,
      hooks: 12,
      concepts: 3,
      scripts: 1,
      breakdowns: 1,
      thumbnailReview: false,
      styleLock: true,
    };
    const app = appWith({ flowCounts: (channel) => (channel === CHANNEL_ID ? counts : null) });

    expect((await read(await get(app, `/api/flow?channel=${CHANNEL_ID}`))).data).toEqual(counts);
    expect((await get(app, `/api/flow?channel=${FROM}`)).status).toBe(404);
    expect((await get(app, '/api/flow')).status).toBe(400);
  });
});

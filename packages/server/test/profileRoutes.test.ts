import {
  SqliteBrandRepo,
  SqliteChannelRepo,
  SqliteMapRepo,
  SqliteVideoRepo,
  openDatabase,
  type ChannelProfile,
} from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import type { ExtrasEngine } from '../src/extrasTypes';
import { JobStore } from '../src/jobs';
import { profileEngine } from '../src/profileEngine';
import { CHANNEL_ID, HOST, get, post, read, stubEngine, withExtras } from './support';

const appWith = (parts: Partial<ExtrasEngine>) =>
  createApp({ engine: stubEngine(withExtras(parts)), jobs: new JobStore(), allowedHosts: [HOST] });

const NOW = new Date('2026-11-21T12:00:00Z');
const profile: ChannelProfile = {
  id: CHANNEL_ID,
  title: 'Mine',
  handle: null,
  subscribers: 10,
  subscribersHidden: false,
  videoCount: null,
  logoUrl: null,
  readAt: NOW.toISOString(),
  hasMap: false,
  stored: { videos: 0, views: 0, capped: false },
  uploads: { last30Days: 0, last90Days: 0, perWeek: 0 },
  lastUpload: null,
  outliers: { minScore: 2, windowDays: 30, all: 0, recent: 0 },
  recent: [],
  top: [],
};
const PATH = `/api/channels/profile?channel=${CHANNEL_ID}`;

describe('GET /api/channels/profile', () => {
  test("answers a stored channel's profile in the envelope", async () => {
    const reply = await read<ChannelProfile>(
      await get(appWith({ findChannelProfile: () => profile }), PATH),
    );

    expect(reply).toMatchObject({ success: true, data: profile, error: null });
  });

  test('is 404 for a channel not stored, 400 for a bad id, 403 from another host, 405 for a write', async () => {
    expect((await get(appWith({ findChannelProfile: () => null }), PATH)).status).toBe(404);
    expect((await get(appWith({}), '/api/channels/profile?channel=x')).status).toBe(400);
    expect(
      (await get(appWith({ findChannelProfile: () => profile }), PATH, 'evil.example')).status,
    ).toBe(403);
    expect((await post(appWith({}), '/api/channels/profile', { channel: CHANNEL_ID })).status).toBe(
      405,
    );
  });
});

describe('GET /api/channels/search and /api/channels/find', () => {
  const found = { id: CHANNEL_ID, title: 'Mine', handle: '@mine', subscribers: 10, logoUrl: null };

  test('search answers the stored channels the letters match', async () => {
    const asked: string[] = [];
    const app = appWith({
      searchChannels: (words) => {
        asked.push(words);
        return [found];
      },
    });
    const reply = await read<{ channels: unknown[] }>(
      await get(app, '/api/channels/search?q=%20mi%20'),
    );
    expect(reply.data.channels).toEqual([found]);
    expect(asked).toEqual(['mi']);
    expect((await get(app, '/api/channels/search')).status).toBe(400);
    expect((await get(app, `/api/channels/search?q=${'x'.repeat(201)}`)).status).toBe(400);
  });

  test('find answers the stored channel a link names, null when not stored, 400 for no channel', async () => {
    const app = appWith({
      findStoredChannel: (ref) => {
        if (ref === 'not a channel') throw new Error('Not a valid YouTube channel');
        return ref.includes('mine') ? found : null;
      },
    });
    const link = encodeURIComponent('https://www.youtube.com/@mine');
    const hit = await read<{ channel: unknown }>(
      await get(app, `/api/channels/find?channel=${link}`),
    );
    expect(hit.data.channel).toEqual(found);
    const miss = await read<{ channel: unknown }>(
      await get(app, '/api/channels/find?channel=@other'),
    );
    expect(miss.data.channel).toBeNull();
    expect((await get(app, '/api/channels/find?channel=not%20a%20channel')).status).toBe(400);
    expect((await get(app, '/api/channels/find')).status).toBe(400);
  });
});

describe('profileEngine', () => {
  test('reads the store, and has nothing for a channel it does not hold', () => {
    const db = openDatabase(':memory:');
    const repos = {
      channels: new SqliteChannelRepo(db),
      videos: new SqliteVideoRepo(db),
      maps: new SqliteMapRepo(db),
      brands: new SqliteBrandRepo(db),
    };
    repos.channels.upsert(
      {
        id: CHANNEL_ID,
        title: 'Mine',
        handle: null,
        subscribers: 10,
        subscribersHidden: false,
        videoCount: null,
      },
      NOW,
    );
    const engine = profileEngine({ now: () => NOW, repos });

    expect(engine.findChannelProfile(CHANNEL_ID)).toEqual(profile);
    expect(engine.findChannelProfile(`UC${'n'.repeat(22)}`)).toBeNull();
  });

  test('searches every stored channel, whichever map read it, and finds one by link or handle', () => {
    const db = openDatabase(':memory:');
    const repos = {
      channels: new SqliteChannelRepo(db),
      videos: new SqliteVideoRepo(db),
      maps: new SqliteMapRepo(db),
      brands: new SqliteBrandRepo(db),
    };
    const other = `UC${'o'.repeat(22)}`;
    const base = { subscribersHidden: false, videoCount: null };
    repos.channels.upsert(
      { ...base, id: CHANNEL_ID, title: 'Steel Daily', handle: 'steeldaily', subscribers: 900 },
      NOW,
    );
    repos.channels.upsert(
      {
        ...base,
        id: other,
        title: 'Deep Steel Works',
        handle: null,
        subscribers: 5000,
        subscribersHidden: true,
      },
      NOW,
    );
    const engine = profileEngine({ now: () => NOW, repos });

    expect(engine.searchChannels('steel')).toEqual([
      {
        id: CHANNEL_ID,
        title: 'Steel Daily',
        handle: 'steeldaily',
        subscribers: 900,
        logoUrl: null,
      },
      { id: other, title: 'Deep Steel Works', handle: null, subscribers: null, logoUrl: null },
    ]);
    expect(engine.searchChannels('zzz')).toEqual([]);
    expect(engine.findStoredChannel(`https://www.youtube.com/channel/${other}`)?.title).toBe(
      'Deep Steel Works',
    );
    expect(engine.findStoredChannel('https://www.youtube.com/@SteelDaily')?.id).toBe(CHANNEL_ID);
    expect(engine.findStoredChannel('@nobodyhere')).toBeNull();
    expect(() => engine.findStoredChannel('not a channel')).toThrow();
  });
});

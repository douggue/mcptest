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
});

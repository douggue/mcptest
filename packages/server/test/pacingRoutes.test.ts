import {
  SqliteChannelRepo,
  SqliteEdgeRepo,
  SqliteMapRepo,
  SqliteVideoPageRepo,
  SqliteVideoRepo,
  openDatabase,
  type PacingView,
} from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import type { ExtrasEngine } from '../src/extrasTypes';
import { JobStore } from '../src/jobs';
import { pacingEngine } from '../src/pacingEngine';
import { CHANNEL_ID, HOST, get, post, read, stubEngine, withExtras } from './support';

const appWith = (parts: Partial<ExtrasEngine>) =>
  createApp({ engine: stubEngine(withExtras(parts)), jobs: new JobStore(), allowedHosts: [HOST] });

const none = { count: 0, median: null, lower: null, upper: null };
const view: PacingView = {
  centerChannelId: CHANNEL_ID,
  lengths: { own: none, winners: none },
  shortsLeftOut: { own: 0, winners: 0 },
  wordsPerMinute: { own: none, winners: none },
  rule: { minScore: 2, windowDays: 30, perChannel: 4 },
  lookalikes: 0,
};

describe('GET /api/pacing', () => {
  test("answers the channel's lengths and pace, 404 with no map, 400 for a bad channel", async () => {
    const found = await get(
      appWith({ findPacing: () => view }),
      `/api/pacing?channel=${CHANNEL_ID}`,
    );
    expect((await read<PacingView>(found)).data).toEqual(view);
    expect(
      (await get(appWith({ findPacing: () => null }), `/api/pacing?channel=${CHANNEL_ID}`)).status,
    ).toBe(404);
    expect((await get(appWith({}), '/api/pacing?channel=x')).status).toBe(400);
    expect(
      (
        await get(
          appWith({ findPacing: () => view }),
          `/api/pacing?channel=${CHANNEL_ID}`,
          'evil.example',
        )
      ).status,
    ).toBe(403);
    expect((await post(appWith({}), '/api/pacing', { channel: CHANNEL_ID })).status).toBe(405);
  });
});

describe('pacingEngine', () => {
  test('reads the store, and has nothing for a channel with no map', () => {
    const db = openDatabase(':memory:');
    const repos = {
      channels: new SqliteChannelRepo(db),
      videos: new SqliteVideoRepo(db),
      edges: new SqliteEdgeRepo(db),
      maps: new SqliteMapRepo(db),
      transcripts: new SqliteVideoPageRepo(db),
    };
    const now = new Date('2026-11-21T12:00:00Z');
    repos.channels.upsert(
      {
        id: CHANNEL_ID,
        title: 'Mine',
        handle: null,
        subscribers: 1,
        subscribersHidden: false,
        videoCount: null,
      },
      now,
    );
    repos.maps.create(
      {
        centerChannelId: CHANNEL_ID,
        depth: 1,
        region: 'US',
        members: [{ channelId: CHANNEL_ID, steps: 0 }],
      },
      now,
    );
    const engine = pacingEngine({ now: () => now, repos });

    expect(engine.findPacing(CHANNEL_ID)?.lookalikes).toBe(0);
    expect(engine.findPacing(`UC${'n'.repeat(22)}`)).toBeNull();
  });
});

import type { SearchHit, YouTubeSource } from '@jgtube/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createEngine, type RunningEngine } from '../src/engine';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const CHANNEL_ID = `UC${'S'.repeat(22)}`;

const source: YouTubeSource = {
  resolveChannelId: async () => CHANNEL_ID,
  getSidebar: async () => [],
  fetchChannel: async (channelId) => ({
    channel: {
      id: channelId,
      title: 'Channel S',
      handle: 'channels',
      subscribers: 1000,
      subscribersHidden: false,
      videoCount: 1,
    },
    videos: [
      {
        id: 'SSSSSSSSSS1',
        channelId,
        title: 'How it was built',
        views: 5000,
        durationSeconds: 600,
        published: { date: new Date(NOW.getTime() - DAY_MS), precision: 'day', raw: '1d ago' },
      },
    ],
  }),
};

const hit: SearchHit = {
  videoId: 'SSSSSSSSSS1',
  channelId: CHANNEL_ID,
  channelTitle: 'Channel S',
  title: 'How it was built',
  publishedAt: new Date(NOW.getTime() - DAY_MS),
};

interface World {
  readonly engine: RunningEngine;
  /** How many times a connection to YouTube was attempted. */
  readonly attempts: () => number;
  /** Moves the clock on, so stored channels fall due for a refresh. */
  readonly later: (days: number) => void;
}

/** An engine whose first `failures` attempts to connect to YouTube fail. */
function world(failures: number, dbPath = ':memory:'): World {
  let attempts = 0;
  let now = NOW;
  const engine = createEngine(
    { dbPath, region: 'US', youtubeApiKey: 'a-key-of-plausible-length' },
    {
      now: () => now,
      search: async () => [hit],
      createSource: async () => {
        attempts += 1;
        if (attempts <= failures) throw new Error('offline');
        return source;
      },
    },
  );
  return {
    engine,
    attempts: () => attempts,
    later: (days) => {
      now = new Date(now.getTime() + days * DAY_MS);
    },
  };
}

describe('the connection to YouTube', () => {
  test('a crawl that could not connect does not stop the next one', async () => {
    const { engine, attempts } = world(1);

    await expect(engine.crawl(CHANNEL_ID, 1, () => {})).rejects.toThrow('offline');
    const result = await engine.crawl(CHANNEL_ID, 1, () => {});

    expect(result.centerChannelId).toBe(CHANNEL_ID);
    expect(attempts()).toBe(2);
    engine.close();
  });

  test('a keyword search that could not connect does not stop the next one', async () => {
    const { engine, attempts } = world(1);

    await expect(engine.discover('built')).rejects.toThrow('offline');
    const found = await engine.discover('built');

    expect(found.added).toEqual([CHANNEL_ID]);
    expect(attempts()).toBe(2);
    engine.close();
  });

  test('a refresh that could not connect does not stop the next one', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'jgtube-engine-')), 'store.db');
    const seeded = world(0, dbPath);
    await seeded.engine.discover('built');
    seeded.engine.close();
    const { engine, attempts, later } = world(1, dbPath);
    later(2);

    const first = await engine.refresh(() => {});
    // Long enough that a channel which failed once is tried again.
    later(40);
    const second = await engine.refresh(() => {});
    // Tidied before anything is checked, so a failure leaves no folder behind.
    engine.close();
    rmSync(dirname(dbPath), { recursive: true, force: true });

    expect(first).toMatchObject({ refreshed: 0, failed: 1 });
    expect(second).toMatchObject({ refreshed: 1, failed: 0 });
    expect(attempts()).toBe(2);
  });

  test('one connection serves a crawl, a search and a refresh alike', async () => {
    const { engine, attempts, later } = world(0);

    await engine.crawl(CHANNEL_ID, 1, () => {});
    await engine.discover('built');
    later(2);
    await engine.refresh(() => {});

    expect(attempts()).toBe(1);
    engine.close();
  });
});

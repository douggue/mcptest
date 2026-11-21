import {
  READING_ELSEWHERE,
  ReadingElsewhereError,
  SqliteLeaseRepo,
  openDatabase,
  type YouTubeSource,
} from '@jgtube/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { createEngine, type RunningEngine } from '../src/engine';
import { JobStore } from '../src/jobs';
import { startThroughApi } from '../src/schedule';
import { CHANNEL_ID, HOST, get, post, read, stubEngine } from './support';

const NOW = new Date('2026-11-20T12:00:00Z');
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

describe('while another program is reading YouTube', () => {
  const calls: string[] = [];
  const app = createApp({
    engine: stubEngine({
      isReadingYouTube: () => true,
      canDiscover: () => true,
      crawl: async () => {
        calls.push('crawl');
        return { centerChannelId: CHANNEL_ID, warnings: [] };
      },
    }),
    jobs: new JobStore(),
    allowedHosts: [HOST],
  });

  test.each([
    ['/api/maps', { channel: CHANNEL_ID }],
    ['/api/refresh', {}],
    ['/api/niches/discover', { keyword: 'new invention' }],
  ])('%s is refused, and says where the reading is going on', async (path, body) => {
    const response = await post(app, path, body);

    expect(response.status).toBe(409);
    expect((await read(response)).error).toBe(READING_ELSEWHERE);
    expect(READING_ELSEWHERE).toMatch(/another window or process/);
    expect(calls).toEqual([]);
  });

  test('the timer comes back soon instead of counting a refresh as started', async () => {
    expect(await startThroughApi(app, HOST)()).toBe(false);
  });

  test('reading the store is not held up', async () => {
    const open = createApp({
      engine: stubEngine({ isReadingYouTube: () => true, findSnapshot: () => null }),
      jobs: new JobStore(),
      allowedHosts: [HOST],
    });

    expect((await get(open, `/api/maps/latest?channel=${CHANNEL_ID}`)).status).toBe(404);
  });
});

describe('a keyword search that loses the lease at the last moment', () => {
  test('is answered as a refusal, not as a failed search', async () => {
    const app = createApp({
      engine: stubEngine({
        isReadingYouTube: () => false,
        canDiscover: () => true,
        discover: () => Promise.reject(new ReadingElsewhereError()),
      }),
      jobs: new JobStore(),
      allowedHosts: [HOST],
    });

    const response = await post(app, '/api/niches/discover', { keyword: 'new invention' });

    expect(response.status).toBe(409);
    expect((await read(response)).error).toBe(READING_ELSEWHERE);
  });
});

describe('the engine and the lease in the store', () => {
  let folder: string;
  let engine: RunningEngine;
  let connections = 0;
  let clock = NOW;
  /** The store as another program (the connector, the command line) has it open. */
  let theirs: SqliteLeaseRepo;
  let closeTheirs: () => void;

  const source: YouTubeSource = {
    resolveChannelId: async () => CHANNEL_ID,
    fetchVideoPage: async () => {
      throw new Error('fetchVideoPage is not used in this test');
    },
    getSidebar: async () => [],
    fetchChannel: async (channelId) => ({
      channel: {
        id: channelId,
        title: 'Channel',
        handle: 'channel',
        subscribers: 1000,
        subscribersHidden: false,
        videoCount: 1,
      },
      videos: [
        {
          id: 'LLLLLLLLLL1',
          channelId,
          title: 'How it was built',
          views: 5000,
          durationSeconds: 600,
          published: { date: new Date(NOW.getTime() - DAY_MS), precision: 'day', raw: '1d ago' },
        },
      ],
    }),
  };

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'jgtube-server-lease-'));
    const dbPath = join(folder, 'store.db');
    connections = 0;
    clock = NOW;
    engine = createEngine(
      { dbPath, region: 'US', youtubeApiKey: 'a-key-of-plausible-length' },
      {
        now: () => clock,
        search: async () => [],
        createSource: async () => {
          connections += 1;
          return source;
        },
      },
    );
    const other = openDatabase(dbPath);
    theirs = new SqliteLeaseRepo(other);
    closeTheirs = () => other.close();
  });

  afterEach(() => {
    engine.close();
    closeTheirs();
    rmSync(folder, { recursive: true, force: true });
  });

  test('a crawl, a refresh and a keyword search are refused while another program holds it', async () => {
    theirs.acquire('the-connector', NOW, new Date(NOW.getTime() + 2 * MINUTE_MS));

    expect(engine.isReadingYouTube()).toBe(true);
    await expect(engine.crawl(CHANNEL_ID, 1, () => {})).rejects.toBeInstanceOf(
      ReadingElsewhereError,
    );
    await expect(engine.refresh(() => {})).rejects.toBeInstanceOf(ReadingElsewhereError);
    await expect(engine.discover('built')).rejects.toBeInstanceOf(ReadingElsewhereError);
    expect(connections).toBe(0);
  });

  test('they run once that program is done, and give the lease back afterwards', async () => {
    theirs.acquire('the-connector', NOW, new Date(NOW.getTime() + 2 * MINUTE_MS));
    theirs.release('the-connector');

    expect(engine.isReadingYouTube()).toBe(false);
    await engine.crawl(CHANNEL_ID, 1, () => {});
    await engine.discover('built');
    await engine.refresh(() => {});

    expect(engine.isReadingYouTube()).toBe(false);
    expect(theirs.holder(clock)).toBeNull();
  });

  test('they run when that program died and its lease ran out', async () => {
    theirs.acquire('died', NOW, new Date(NOW.getTime() + 2 * MINUTE_MS));
    clock = new Date(NOW.getTime() + 2 * MINUTE_MS);

    await expect(engine.crawl(CHANNEL_ID, 1, () => {})).resolves.toMatchObject({
      centerChannelId: CHANNEL_ID,
    });
  });

  test('another program is refused while this one crawls', async () => {
    let seenByThem: string | null = null;

    await engine.crawl(CHANNEL_ID, 1, () => {
      seenByThem ??= theirs.holder(clock);
    });

    expect(seenByThem).not.toBeNull();
  });
});

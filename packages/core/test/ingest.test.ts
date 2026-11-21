import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, transactionRunner } from '../src/db/sqlite';
import { ingestChannel, type IngestDeps } from '../src/ingest';
import { buildVideoReport } from '../src/report';
import { SqliteBrandRepo } from '../src/repos/sqliteBrandRepo';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { StoredVideo } from '../src/repos/types';
import type { ChannelInfo, ChannelSnapshot, VideoItem, YouTubeSource } from '../src/sources/types';

const CHANNEL_ID = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const START = new Date('2026-11-20T12:00:00Z');
const HOUR_MS = 3_600_000;

const channel: ChannelInfo = {
  id: CHANNEL_ID,
  title: 'Veritasium',
  handle: 'veritasium',
  subscribers: 21_500_000,
  subscribersHidden: false,
  videoCount: 552,
};

const makeVideo = (id: string, views: number | null, daysAgo: number | null): VideoItem => ({
  id,
  channelId: CHANNEL_ID,
  title: `Video ${id}`,
  views,
  durationSeconds: 600,
  published:
    daysAgo === null
      ? null
      : {
          date: new Date(START.getTime() - daysAgo * 86_400_000),
          precision: 'day',
          raw: `${daysAgo}d ago`,
        },
});

class FakeSource implements YouTubeSource {
  resolveCalls = 0;
  fetchCalls = 0;
  lastMax = 0;
  constructor(private readonly snapshot: ChannelSnapshot) {}

  async resolveChannelId(): Promise<string> {
    this.resolveCalls += 1;
    return CHANNEL_ID;
  }

  async fetchChannel(_id: string, maxVideos: number): Promise<ChannelSnapshot> {
    this.fetchCalls += 1;
    this.lastMax = maxVideos;
    return this.snapshot;
  }

  async fetchVideoPage(): Promise<never> {
    throw new Error('fetchVideoPage is not used in this test');
  }

  async getSidebar(): Promise<readonly never[]> {
    return [];
  }
}

let source: FakeSource;
let clock: Date;
let deps: IngestDeps;

beforeEach(() => {
  const db = openDatabase(':memory:');
  source = new FakeSource({
    channel,
    videos: [
      makeVideo('a', 1000, 40),
      makeVideo('b', 1000, 50),
      makeVideo('c', 1000, 60),
      makeVideo('hit', 9000, 45),
      makeVideo('live', null, 0),
      makeVideo('undated', 500, null),
    ],
  });
  clock = START;
  deps = {
    source,
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    transact: transactionRunner(db),
    now: () => clock,
  };
});

describe('ingestChannel', () => {
  test('stores the logo, cover and bio that came with the channel page, when given somewhere to', async () => {
    const db = openDatabase(':memory:');
    const brands = new SqliteBrandRepo(db);
    const brand = {
      description: 'An element of truth',
      avatar: [{ url: 'https://yt3.googleusercontent.com/logo', width: 160, height: 160 }],
      banner: [],
      keywords: ['science'],
      links: [],
    };
    const withBrand = new FakeSource({ channel, videos: [makeVideo('a', 1000, 40)], brand });

    await ingestChannel(
      {
        source: withBrand,
        channels: new SqliteChannelRepo(db),
        videos: new SqliteVideoRepo(db),
        transact: transactionRunner(db),
        now: () => START,
        brands,
      },
      CHANNEL_ID,
    );

    expect(brands.find(CHANNEL_ID)).toEqual({ channelId: CHANNEL_ID, ...brand, fetchedAt: START });
  });

  test('stores the channel and its usable videos on the first run', async () => {
    const result = await ingestChannel(deps, '@veritasium');

    expect(result.fromCache).toBe(false);
    expect(result.channel.title).toBe('Veritasium');
    expect(result.videos.map((v) => v.id).sort()).toEqual(['a', 'b', 'c', 'hit']);
    expect(source.lastMax).toBe(100);
  });

  test('makes no requests on a second run inside the freshness window', async () => {
    await ingestChannel(deps, '@veritasium');
    clock = new Date(START.getTime() + 2 * HOUR_MS);

    const second = await ingestChannel(deps, 'https://www.youtube.com/@Veritasium');

    expect(second.fromCache).toBe(true);
    expect(second.videos).toHaveLength(4);
    expect(source.resolveCalls).toBe(1);
    expect(source.fetchCalls).toBe(1);
  });

  test('fetches again once the stored copy is older than the freshness window', async () => {
    await ingestChannel(deps, '@veritasium');
    clock = new Date(START.getTime() + 25 * HOUR_MS);

    const second = await ingestChannel(deps, '@veritasium');

    expect(second.fromCache).toBe(false);
    expect(source.fetchCalls).toBe(2);
  });

  test('fetches again when refresh is requested', async () => {
    await ingestChannel(deps, '@veritasium');

    await ingestChannel(deps, '@veritasium', { refresh: true });

    expect(source.fetchCalls).toBe(2);
  });

  test('skips handle resolution when given a channel id', async () => {
    await ingestChannel(deps, CHANNEL_ID);

    expect(source.resolveCalls).toBe(0);
    expect(source.fetchCalls).toBe(1);
  });

  test('rejects invalid input before making any request', async () => {
    await expect(ingestChannel(deps, 'https://evil.example/@x')).rejects.toThrow(/channel/i);
    expect(source.resolveCalls + source.fetchCalls).toBe(0);
  });
});

describe('buildVideoReport', () => {
  test('ranks videos by outlier score with their age in days', async () => {
    const { videos } = await ingestChannel(deps, '@veritasium');

    const report = buildVideoReport(videos, START);

    expect(report[0]).toMatchObject({ id: 'hit', ageDays: 45 });
    expect(report[0]?.score).toBeCloseTo(9, 1);
    expect(report).toHaveLength(4);
  });

  test('lists unscored videos last', async () => {
    const stored = (id: string, views: number, daysAgo: number): StoredVideo => ({
      id,
      channelId: CHANNEL_ID,
      title: `Video ${id}`,
      views,
      durationSeconds: 600,
      published: {
        date: new Date(START.getTime() - daysAgo * 86_400_000),
        precision: 'day',
        raw: `${daysAgo}d ago`,
      },
      fetchedAt: START,
    });

    const report = buildVideoReport([stored('x', 10, 1), stored('y', 20, 2)], START);

    expect(report.map((r) => r.score)).toEqual([null, null]);
  });
});

/**
 * Behaviour under hostile, broken or unusual input. Each case here is a
 * regression test for a finding from code or security review.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, transactionRunner, type Db } from '../src/db/sqlite';
import { ingestChannel, type IngestDeps } from '../src/ingest';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { VideoRepo } from '../src/repos/types';
import { InnertubeSource, type InnertubeClient, type VideosTab } from '../src/sources/innertube';
import { RateLimiter } from '../src/sources/limiter';
import { mapChannel, mapSidebarItem } from '../src/sources/mappers';
import { parseDuration, parseRelativeDate, parseShortCount } from '../src/sources/parse';
import type {
  ChannelInfo,
  ChannelSnapshot,
  StorableVideo,
  VideoItem,
  YouTubeSource,
} from '../src/sources/types';
import channelFixture from './fixtures/channel.json';

const NOW = new Date('2026-11-20T12:00:00Z');
const LATER = new Date('2026-12-20T12:00:00Z');
const CHANNEL_ID = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const DAY_MS = 86_400_000;

const channel: ChannelInfo = {
  id: CHANNEL_ID,
  title: 'Veritasium',
  handle: 'veritasium',
  subscribers: 21_500_000,
  subscribersHidden: false,
  videoCount: 552,
};

const storable = (id: string, views: number, daysAgo: number, at = NOW): StorableVideo => ({
  id,
  channelId: CHANNEL_ID,
  title: `Video ${id}`,
  views,
  durationSeconds: 600,
  published: {
    date: new Date(at.getTime() - daysAgo * DAY_MS),
    precision: 'day',
    raw: `${daysAgo}d ago`,
  },
});

const quickLimiter = (overrides: Partial<ConstructorParameters<typeof RateLimiter>[0]> = {}) =>
  new RateLimiter({
    concurrency: 1,
    minDelayMs: 0,
    maxDelayMs: 0,
    maxRetries: 0,
    baseBackoffMs: 0,
    sleep: async () => {},
    ...overrides,
  });

describe('parsers with unusual text', () => {
  test.each(['99999999999 years ago', '500 years ago', `${'x'.repeat(300)} 2d ago`])(
    'reject the date %j instead of producing an unusable one',
    (raw) => {
      expect(parseRelativeDate(raw, NOW)).toBeNull();
    },
  );

  test('do not read punctuation alone as a count', () => {
    expect(parseShortCount(',')).toBeNull();
    expect(parseShortCount('.')).toBeNull();
  });

  test('reject durations with out-of-range seconds or minutes', () => {
    expect(parseDuration('1:99')).toBeNull();
    expect(parseDuration('99:59')).toBeNull();
  });
});

describe('RateLimiter under failure', () => {
  test('refuses a concurrency that would never run anything', () => {
    expect(() => quickLimiter({ concurrency: 0 })).toThrow(RangeError);
  });

  test('gives up on a request that never answers', async () => {
    const limiter = quickLimiter({ taskTimeoutMs: 10 });

    await expect(limiter.run(() => new Promise<never>(() => {}))).rejects.toThrow(/timed out/);
  });

  test('does not mistake a number in a message for a server error', async () => {
    const limiter = quickLimiter({ maxRetries: 3 });
    let attempts = 0;

    await expect(
      limiter.run(async () => {
        attempts += 1;
        throw new Error('Could not find item 512');
      }),
    ).rejects.toThrow('item 512');
    expect(attempts).toBe(1);
  });

  test('uses a numeric status on the error when there is one', async () => {
    const limiter = quickLimiter({ maxRetries: 1 });
    const failWith = (status: number) => {
      let attempts = 0;
      const run = limiter
        .run(async () => {
          attempts += 1;
          throw Object.assign(new Error('request failed'), { status });
        })
        .catch(() => attempts);
      return run;
    };

    await expect(failWith(503)).resolves.toBe(2);
    await expect(failWith(404)).resolves.toBe(1);
  });
});

describe('mappers with hostile shapes', () => {
  const sidebarItem = (rows: readonly string[][], title = 'A title') => ({
    type: 'LockupView',
    content_type: 'VIDEO',
    content_id: 'abcdefghijk',
    metadata: {
      title: { text: title },
      metadata: {
        metadata_rows: rows.map((parts) => ({
          metadata_parts: parts.map((text) => ({ text: { text } })),
        })),
      },
    },
  });

  test('do not read a lone numeric channel name as a view count', () => {
    expect(mapSidebarItem(sidebarItem([['2020']]), NOW)).toMatchObject({
      views: null,
      channelName: null,
    });
  });

  test('cap the length of stored text', () => {
    const item = sidebarItem([['Channel'], ['1K', '2d ago']], 'T'.repeat(5000));

    expect(mapSidebarItem(item, NOW)?.title).toHaveLength(300);
  });

  test('survive a header that refers back to itself', () => {
    const header: Record<string, unknown> = { row: { text: '1.2K subscribers' } };
    header['self'] = header;

    expect(mapChannel(header, channelFixture.metadata)?.subscribers).toBe(1200);
  });

  test('survive a very large array without overflowing the stack', () => {
    const header = { items: new Array(200_000).fill(0) };

    expect(mapChannel(header, channelFixture.metadata)?.subscribers).toBeNull();
  });
});

describe('InnertubeSource with bad input or endless pages', () => {
  const clientWith = (firstTab: VideosTab): InnertubeClient => ({
    resolveURL: async () => ({}),
    getChannel: async () => ({
      header: channelFixture.header,
      metadata: channelFixture.metadata,
      getVideos: async () => firstTab,
    }),
    getInfo: async () => ({ watch_next_feed: [] }),
  });
  const makeSource = (client: InnertubeClient) =>
    new InnertubeSource(client, quickLimiter(), () => NOW);

  test('rejects ids that are not YouTube ids before making a request', async () => {
    const source = makeSource(clientWith({} as VideosTab));

    await expect(source.fetchChannel('../../etc', 10)).rejects.toThrow(/channel id/);
    await expect(source.getSidebar('not a video')).rejects.toThrow(/video id/);
  });

  test('stops after a bounded number of pages when nothing can be read', async () => {
    let continuations = 0;
    const endless: VideosTab = {
      videos: [{ type: 'Unreadable' }],
      has_continuation: true,
      getContinuation: async () => {
        continuations += 1;
        return endless;
      },
    };

    const snapshot = await makeSource(clientWith(endless)).fetchChannel(CHANNEL_ID, 100);

    expect(snapshot.videos).toEqual([]);
    expect(continuations).toBe(9);
  });

  test('does not ask for more after an empty page', async () => {
    let continuations = 0;
    const empty: VideosTab = {
      videos: [],
      has_continuation: true,
      getContinuation: async () => {
        continuations += 1;
        return empty;
      },
    };

    await makeSource(clientWith(empty)).fetchChannel(CHANNEL_ID, 100);

    expect(continuations).toBe(0);
  });
});

describe('repositories across repeated fetches', () => {
  let db: Db;
  let channels: SqliteChannelRepo;
  let videos: SqliteVideoRepo;

  beforeEach(() => {
    db = openDatabase(':memory:');
    channels = new SqliteChannelRepo(db);
    videos = new SqliteVideoRepo(db);
    channels.upsert(channel, NOW);
  });

  test('keep a known handle when a later fetch does not report one', () => {
    channels.upsert({ ...channel, handle: null }, LATER);

    expect(channels.findByHandle('veritasium')?.fetchedAt).toEqual(LATER);
  });

  test('keep the first-seen publish date, which is the most precise', () => {
    const first = storable('abc', 100, 2, NOW);
    videos.upsertMany([first], NOW);
    const coarser: StorableVideo = {
      ...first,
      views: 900,
      published: {
        date: new Date(LATER.getTime() - 30 * DAY_MS),
        precision: 'month',
        raw: '1mo ago',
      },
    };

    videos.upsertMany([coarser], LATER);

    expect(videos.listByChannel(CHANNEL_ID)[0]).toMatchObject({
      views: 900,
      published: first.published,
    });
  });
});

describe('ingestChannel when the fetch is unusable or the write fails', () => {
  class StubSource implements YouTubeSource {
    resolveCalls = 0;
    fetchCalls = 0;
    constructor(private readonly videos: readonly VideoItem[]) {}

    async resolveChannelId(): Promise<string> {
      this.resolveCalls += 1;
      return CHANNEL_ID;
    }

    async fetchChannel(): Promise<ChannelSnapshot> {
      this.fetchCalls += 1;
      return { channel, videos: this.videos };
    }

    async getSidebar(): Promise<readonly never[]> {
      return [];
    }
  }

  const depsFor = (source: YouTubeSource, db: Db, videos?: VideoRepo): IngestDeps => ({
    source,
    channels: new SqliteChannelRepo(db),
    videos: videos ?? new SqliteVideoRepo(db),
    transact: transactionRunner(db),
    now: () => NOW,
  });

  test('stores nothing when every video is unreadable, so the next run fetches again', async () => {
    const db = openDatabase(':memory:');
    const unreadable: VideoItem = { ...storable('abc', 1, 1), views: null, published: null };
    const source = new StubSource([unreadable, { ...unreadable, id: 'def' }]);
    const deps = depsFor(source, db);

    await expect(ingestChannel(deps, '@veritasium')).rejects.toThrow(/none had readable/);
    await expect(ingestChannel(deps, '@veritasium')).rejects.toThrow(/none had readable/);

    expect(deps.channels.findById(CHANNEL_ID)).toBeNull();
    expect(source.fetchCalls).toBe(2);
  });

  test('stores a channel that simply has no videos', async () => {
    const db = openDatabase(':memory:');
    const result = await ingestChannel(depsFor(new StubSource([]), db), '@veritasium');

    expect(result.videos).toEqual([]);
    expect(result.fromCache).toBe(false);
  });

  test('does not leave a channel marked fresh when writing its videos fails', async () => {
    const db = openDatabase(':memory:');
    const real = new SqliteVideoRepo(db);
    const failing: VideoRepo = {
      listByChannel: (id) => real.listByChannel(id),
      listSnapshots: (id) => real.listSnapshots(id),
      upsertMany: () => {
        throw new Error('disk full');
      },
    };
    const deps = depsFor(new StubSource([storable('abc', 1, 1)]), db, failing);

    await expect(ingestChannel(deps, '@veritasium')).rejects.toThrow('disk full');

    expect(deps.channels.findById(CHANNEL_ID)).toBeNull();
  });

  test('looks the handle up again on a refresh, in case it changed hands', async () => {
    const db = openDatabase(':memory:');
    const source = new StubSource([storable('abc', 1, 1)]);
    const deps = depsFor(source, db);

    await ingestChannel(deps, '@veritasium');
    await ingestChannel(deps, '@veritasium', { refresh: true });

    expect(source.resolveCalls).toBe(2);
  });
});

import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, transactionRunner } from '../src/db/sqlite';
import { discoverByKeyword, type DiscoveryDeps } from '../src/discovery/keyword';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { SearchHit } from '../src/sources/dataApi';
import type { ChannelSnapshot, YouTubeSource } from '../src/sources/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (letter: string, n: number) => letter.repeat(10) + String(n);

const hit = (letter: string, n: number): SearchHit => ({
  videoId: vid(letter, n),
  channelId: cid(letter),
  channelTitle: `Channel ${letter}`,
  title: `${letter} video ${n}`,
  publishedAt: new Date(NOW.getTime() - n * DAY_MS),
});

class FakeSource implements YouTubeSource {
  fetched: string[] = [];
  failing = new Set<string>();

  async resolveChannelId(): Promise<string> {
    throw new Error('not used');
  }

  async fetchChannel(channelId: string): Promise<ChannelSnapshot> {
    const letter = channelId.charAt(2);
    if (this.failing.has(letter)) throw new Error(`cannot read ${letter}`);
    this.fetched.push(letter);
    return {
      channel: {
        id: channelId,
        title: `Channel ${letter}`,
        handle: null,
        subscribers: 500,
        subscribersHidden: false,
        videoCount: 1,
      },
      videos: [
        {
          id: vid(letter, 1),
          channelId,
          title: `${letter} video 1`,
          views: 1000,
          durationSeconds: 600,
          published: { date: new Date(NOW.getTime() - DAY_MS), precision: 'day', raw: '1d ago' },
        },
      ],
    };
  }

  async getSidebar(): Promise<readonly never[]> {
    return [];
  }
}

let source: FakeSource;
let searches: Array<{ query: string; publishedAfter: Date }>;
let results: readonly SearchHit[];
let deps: DiscoveryDeps;

beforeEach(() => {
  const db = openDatabase(':memory:');
  source = new FakeSource();
  searches = [];
  results = [];
  deps = {
    source,
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    transact: transactionRunner(db),
    now: () => NOW,
    search: async (query, options) => {
      searches.push({ query, publishedAfter: options.publishedAfter });
      return results;
    },
  };
});

describe('discoverByKeyword', () => {
  test('searches for videos from the last ninety days by default', async () => {
    await discoverByKeyword(deps, 'new invention');

    expect(searches).toEqual([
      { query: 'new invention', publishedAfter: new Date(NOW.getTime() - 90 * DAY_MS) },
    ]);
  });

  test('reads each channel found into the store, the ones with most matching videos first', async () => {
    results = [hit('A', 1), hit('B', 1), hit('B', 2), hit('C', 1), hit('B', 3), hit('C', 2)];

    const found = await discoverByKeyword(deps, 'new invention');

    expect(source.fetched).toEqual(['B', 'C', 'A']);
    expect(found).toMatchObject({
      keyword: 'new invention',
      videosFound: 6,
      channelsFound: 3,
      added: [cid('B'), cid('C'), cid('A')],
      alreadyKnown: [],
      failed: [],
    });
    expect(deps.channels.findById(cid('B'))?.title).toBe('Channel B');
  });

  test('reads no more channels than the limit', async () => {
    results = [hit('A', 1), hit('B', 1), hit('C', 1)];

    const found = await discoverByKeyword(deps, 'new invention', { maxChannels: 2 });

    expect(source.fetched).toEqual(['A', 'B']);
    expect(found.channelsFound).toBe(3);
  });

  test('does not read again a channel the store already holds fresh', async () => {
    results = [hit('A', 1)];
    await discoverByKeyword(deps, 'new invention');

    const again = await discoverByKeyword(deps, 'new invention');

    expect(source.fetched).toEqual(['A']);
    expect(again).toMatchObject({ added: [], alreadyKnown: [cid('A')] });
  });

  test('carries on when one channel cannot be read', async () => {
    results = [hit('A', 1), hit('B', 1)];
    source.failing.add('A');

    const found = await discoverByKeyword(deps, 'new invention');

    expect(found.added).toEqual([cid('B')]);
    expect(found.failed).toEqual([{ channelId: cid('A'), error: 'cannot read A' }]);
  });

  test.each(['', '   ', 'x'.repeat(201)])('rejects the keyword %j', async (keyword) => {
    await expect(discoverByKeyword(deps, keyword)).rejects.toThrow(/keyword/i);
    expect(searches).toEqual([]);
  });
});

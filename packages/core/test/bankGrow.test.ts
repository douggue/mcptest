import { describe, expect, test } from 'vitest';
import {
  API_SEARCH_UNITS,
  BANK_FIND_DAILY_API_UNITS,
  BANK_FIND_DAILY_PAGE_REQUESTS,
  PAGE_REQUESTS_PER_CHANNEL,
  findAllowance,
  planFind,
  planSpend,
  topicQuery,
} from '../src/bank/cost';
import { FindCapError, allowanceNow, findMoreOutliers, type FindDeps } from '../src/bank/grow';
import { openDatabase, transactionRunner } from '../src/db/sqlite';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteFindRepo } from '../src/repos/sqliteFindRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { ChannelSnapshot, YouTubeSource } from '../src/sources/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const cid = (letter: string) => `UC${letter.repeat(22)}`;

describe('what a find costs', () => {
  test('is said before it starts, for pages and for the API', () => {
    expect(planFind('pages', 10)).toEqual({
      via: 'pages',
      channels: 10,
      requests: 1 + 10 * PAGE_REQUESTS_PER_CHANNEL,
      apiUnits: 0,
    });
    const api = planFind('api', 10);
    expect(api.requests).toBe(1 + 1 + 40);
    expect(api.apiUnits).toBe(API_SEARCH_UNITS + 41);
    expect(planSpend(api)).toBe(api.apiUnits);
  });

  test('a day’s cap is kept, never below nothing', () => {
    expect(findAllowance('pages', 100)).toEqual({
      via: 'pages',
      cap: BANK_FIND_DAILY_PAGE_REQUESTS,
      used: 100,
      left: BANK_FIND_DAILY_PAGE_REQUESTS - 100,
    });
    expect(findAllowance('api', 99_999).left).toBe(0);
    expect(findAllowance('api', 0).cap).toBe(BANK_FIND_DAILY_API_UNITS);
  });

  test('a topic searches for its words', () => {
    expect(topicQuery('Science & space')).toBe('Science space');
  });
});

function snapshot(letter: string): ChannelSnapshot {
  return {
    channel: {
      id: cid(letter),
      title: `Channel ${letter}`,
      handle: null,
      subscribers: 1000,
      subscribersHidden: false,
      videoCount: 3,
    },
    videos: [0, 1, 2].map((n) => ({
      id: `${letter.repeat(10)}${n}`,
      channelId: cid(letter),
      title: `Video ${n}`,
      views: 1000 * (n + 1),
      durationSeconds: 600,
      published: { date: new Date(NOW.getTime() - n * 86_400_000), precision: 'day', raw: `${n}d ago` },
    })),
  };
}

function setup(failOn: string | null = null) {
  const db = openDatabase(':memory:');
  const reads: string[] = [];
  const source: YouTubeSource = {
    resolveChannelId: () => Promise.reject(new Error('unused')),
    getSidebar: () => Promise.reject(new Error('unused')),
    fetchVideoPage: () => Promise.reject(new Error('unused')),
    fetchChannel: (channelId) => {
      reads.push(channelId);
      if (channelId === failOn) return Promise.reject(new Error('gone'));
      return Promise.resolve(snapshot(channelId.charAt(2)));
    },
  };
  const finds = new SqliteFindRepo(db);
  const deps: FindDeps = {
    source,
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    transact: transactionRunner(db),
    now: () => NOW,
    finds,
    via: 'pages',
    search: () =>
      Promise.resolve([
        { videoId: 'aaaaaaaaaa1', channelId: cid('B') },
        { videoId: 'aaaaaaaaaa2', channelId: cid('A') },
        { videoId: 'aaaaaaaaaa3', channelId: cid('A') },
        { videoId: 'aaaaaaaaaa4', channelId: cid('C') },
      ]),
  };
  return { db, deps, reads, finds };
}

describe('finding more outliers', () => {
  test('reads the channels most found first, up to the number asked, and records the spend', async () => {
    const { deps, reads, finds } = setup();
    const progress: string[] = [];
    const outcome = await findMoreOutliers(deps, { query: ' rockets ', maxChannels: 2 }, (p) =>
      progress.push(p.text),
    );
    expect(reads).toEqual([cid('A'), cid('B')]);
    expect(outcome).toMatchObject({
      query: 'rockets',
      videosFound: 4,
      channelsFound: 3,
      channelsRead: 2,
      failed: 0,
      requests: 1 + 2 * PAGE_REQUESTS_PER_CHANNEL,
      apiUnits: 0,
    });
    expect(progress[0]).toContain('rockets');
    expect(finds.spentSince('pages', new Date(0))).toBe(outcome.requests);
    expect(allowanceNow(finds, 'pages', NOW).used).toBe(outcome.requests);
  });

  test('a channel read today costs nothing, and one that fails is reported', async () => {
    const { deps } = setup(cid('B'));
    await findMoreOutliers(deps, { query: 'x', maxChannels: 1 });
    const second = await findMoreOutliers(deps, { query: 'x', maxChannels: 3 });
    expect(second.alreadyKnown).toBe(1);
    expect(second.failed).toBe(1);
    expect(second.problems).toEqual(['gone']);
    expect(second.channelsRead).toBe(1);
  });

  test('counts API requests exactly when reading through the API', async () => {
    const { deps } = setup();
    let made = 0;
    const outcome = await findMoreOutliers(
      {
        ...deps,
        via: 'api',
        apiRequestsMade: () => made,
        search: async () => {
          made += 0;
          return [{ videoId: 'aaaaaaaaaa1', channelId: cid('A') }];
        },
        source: {
          ...deps.source,
          fetchChannel: async (id) => {
            made += 3;
            return snapshot(id.charAt(2));
          },
        },
      },
      { query: 'x', maxChannels: 5 },
    );
    expect(outcome).toMatchObject({ requests: 4, apiUnits: API_SEARCH_UNITS + 3 });
  });

  test('refuses a run the day’s cap cannot cover, before any request', async () => {
    const { deps, reads, finds } = setup();
    finds.record({
      query: 'earlier',
      via: 'pages',
      requests: BANK_FIND_DAILY_PAGE_REQUESTS - 5,
      apiUnits: 0,
      channelsRead: 50,
      startedAt: new Date(NOW.getTime() - 3_600_000),
      finishedAt: NOW,
    });
    await expect(findMoreOutliers(deps, { query: 'x', maxChannels: 2 })).rejects.toBeInstanceOf(
      FindCapError,
    );
    expect(reads).toEqual([]);
  });

  test('refuses words and sizes it cannot take', async () => {
    const { deps } = setup();
    await expect(findMoreOutliers(deps, { query: '  ', maxChannels: 2 })).rejects.toThrow();
    await expect(findMoreOutliers(deps, { query: 'x', maxChannels: 0 })).rejects.toThrow();
    await expect(findMoreOutliers(deps, { query: 'x', maxChannels: 26 })).rejects.toThrow();
  });
});

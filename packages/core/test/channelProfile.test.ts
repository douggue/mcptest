import { beforeEach, describe, expect, test } from 'vitest';
import { PROFILE_VIDEOS, loadChannelProfile } from '../src/channel/profile';
import { openDatabase } from '../src/db/sqlite';
import { DEFAULT_MAX_VIDEOS } from '../src/ingest';
import { SqliteBrandRepo } from '../src/repos/sqliteBrandRepo';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { StorableVideo } from '../src/sources/types';

const NOW = new Date('2026-11-21T12:00:00Z');
const DAY_MS = 86_400_000;
const CHANNEL = `UC${'c'.repeat(22)}`;
const OTHER = `UC${'o'.repeat(22)}`;

const video = (id: string, views: number, days: number, channelId = CHANNEL): StorableVideo => ({
  id: id.padEnd(11, '_'),
  channelId,
  title: `Title of ${id}`,
  views,
  durationSeconds: 600,
  published: { date: new Date(NOW.getTime() - days * DAY_MS), precision: 'day', raw: `${days}d` },
});

const makeRepos = () => {
  const db = openDatabase(':memory:');
  return {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    maps: new SqliteMapRepo(db),
    brands: new SqliteBrandRepo(db),
  };
};
let repos: ReturnType<typeof makeRepos>;

const store = (id: string, subscribers: number | null, hidden = false) =>
  repos.channels.upsert(
    {
      id,
      title: id === CHANNEL ? 'Mine' : 'Other',
      handle: id === CHANNEL ? 'mine' : null,
      subscribers,
      subscribersHidden: hidden,
      videoCount: id === CHANNEL ? 240 : null,
    },
    NOW,
  );

beforeEach(() => {
  repos = makeRepos();
  store(CHANNEL, 52_000);
  store(OTHER, null, true);
});

describe('a channel profile', () => {
  test('is nothing for a channel the store does not hold', () => {
    expect(loadChannelProfile(repos, `UC${'x'.repeat(22)}`, NOW)).toBeNull();
  });

  test("gives the channel's stored numbers, labelled by what they rest on", () => {
    // Twelve ordinary videos a week apart, and one that took off.
    const ordinary = Array.from({ length: 12 }, (_, n) => video(`v${n}`, 1000, 3 + n * 7));
    repos.videos.upsertMany([...ordinary, video('hit', 40_000, 10)], NOW);
    repos.videos.upsertMany([video('theirs', 9, 1, OTHER)], NOW);

    const profile = loadChannelProfile(repos, CHANNEL, NOW);

    expect(profile).toMatchObject({
      id: CHANNEL,
      title: 'Mine',
      handle: 'mine',
      subscribers: 52_000,
      videoCount: 240,
      logoUrl: null,
      readAt: NOW.toISOString(),
      hasMap: false,
      stored: { videos: 13, views: 52_000, capped: false },
      uploads: { last30Days: 5, last90Days: 13 },
      lastUpload: { ageDays: 3, publishedRaw: '3d' },
    });
    expect(profile?.uploads.perWeek).toBeCloseTo(1, 0);
    expect(profile?.outliers.minScore).toBeGreaterThan(1);
    expect(profile?.outliers.all).toBe(1);
    expect(profile?.outliers.recent).toBe(1);
    expect(profile?.top.map((row) => row.videoId)).toEqual(['hit________']);
    expect(profile?.top[0]?.score).toBeGreaterThan(10);
  });

  test('lists the newest videos first, and only so many', () => {
    const many = Array.from({ length: PROFILE_VIDEOS + 4 }, (_, n) => video(`n${n}`, 500, n + 1));
    repos.videos.upsertMany(many, NOW);

    const recent = loadChannelProfile(repos, CHANNEL, NOW)?.recent ?? [];

    expect(recent).toHaveLength(PROFILE_VIDEOS);
    expect(recent[0]).toMatchObject({ videoId: 'n0_________', views: 500, durationSeconds: 600 });
    expect(recent.map((row) => row.ageDays)).toEqual([...recent.map((r) => r.ageDays)].sort());
  });

  test('says when the store holds only the newest videos the reader keeps', () => {
    const full = Array.from({ length: DEFAULT_MAX_VIDEOS }, (_, n) => video(`f${n}`, 10, n));
    repos.videos.upsertMany(full, NOW);

    expect(loadChannelProfile(repos, CHANNEL, NOW)?.stored.capped).toBe(true);
  });

  test('has no upload date, rate or outliers for a channel with no stored videos', () => {
    const profile = loadChannelProfile(repos, OTHER, NOW);

    expect(profile).toMatchObject({
      subscribers: null,
      subscribersHidden: true,
      lastUpload: null,
      uploads: { last30Days: 0, last90Days: 0, perWeek: 0 },
      outliers: { all: 0, recent: 0 },
      recent: [],
      top: [],
    });
  });

  test('knows whether a map was made for the channel, and its logo once read', () => {
    repos.maps.create(
      {
        centerChannelId: CHANNEL,
        depth: 1,
        region: 'US',
        members: [{ channelId: CHANNEL, steps: 0 }],
      },
      NOW,
    );
    repos.brands.save(
      CHANNEL,
      {
        avatar: [{ url: 'https://yt3.googleusercontent.com/logo=s176', width: 176, height: 176 }],
        banner: [],
        description: null,
        keywords: [],
        links: [],
      },
      NOW,
    );

    const profile = loadChannelProfile(repos, CHANNEL, NOW);

    expect(profile?.hasMap).toBe(true);
    expect(profile?.logoUrl).toBe('https://yt3.googleusercontent.com/logo=s176');
  });
});

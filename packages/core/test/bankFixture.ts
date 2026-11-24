/** A small store for the outlier bank's tests: two channels, one on a map, one in another alphabet. */
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteMoneyRepo } from '../src/repos/sqliteMoneyRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { StoredVideo } from '../src/repos/types';

export const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
export const cid = (letter: string) => `UC${letter.repeat(22)}`;
export const vid = (letter: string, n: number) => letter.repeat(9) + String(n).padStart(2, '0');

interface Spec {
  readonly views: number;
  readonly daysAgo: number;
  readonly title: string;
  readonly seconds?: number;
}

export function videosOf(letter: string, specs: readonly Spec[]): StoredVideo[] {
  return specs.map((spec, index) => ({
    id: vid(letter, index),
    channelId: cid(letter),
    title: spec.title,
    views: spec.views,
    durationSeconds: spec.seconds ?? 900,
    published: {
      date: new Date(NOW.getTime() - spec.daysAgo * DAY_MS),
      precision: 'day',
      raw: `${spec.daysAgo}d ago`,
    },
    fetchedAt: NOW,
  }));
}

/** Channel A: a rocket channel on a map, whose newest video drew far above its usual. */
export const A_VIDEOS = videosOf('A', [
  { views: 50_000, daysAgo: 10, title: 'Rocket engine built from scrap' },
  { views: 1000, daysAgo: 20, title: 'NASA rocket test explained' },
  { views: 1200, daysAgo: 30, title: 'Space station tour' },
  { views: 900, daysAgo: 40, title: 'Mars rocket landing' },
  { views: 800, daysAgo: 50, title: 'Rocket fuel basics', seconds: 45 },
]);

/** Channel B: titles in Cyrillic, on no map, never checked for money. */
export const B_VIDEOS = videosOf('B', [
  { views: 3000, daysAgo: 3, title: 'Как построить дом' },
  { views: 2000, daysAgo: 100, title: 'Старый дом' },
]);

export function seededStore(): Db {
  const db = openDatabase(':memory:');
  const channels = new SqliteChannelRepo(db);
  const videos = new SqliteVideoRepo(db);
  const info = (letter: string, subscribers: number | null) => ({
    id: cid(letter),
    title: `Channel ${letter}`,
    handle: `@chan${letter}`,
    subscribers,
    subscribersHidden: subscribers === null,
    videoCount: null,
  });
  channels.upsert(info('A', 5000), NOW);
  channels.upsert(info('B', null), NOW);
  channels.upsert(info('C', 90_000), NOW);
  videos.upsertMany(A_VIDEOS, NOW);
  videos.upsertMany(B_VIDEOS, NOW);
  new SqliteMapRepo(db).create(
    {
      centerChannelId: cid('C'),
      depth: 1,
      region: 'US',
      members: [
        { channelId: cid('C'), steps: 0 },
        { channelId: cid('A'), steps: 1 },
      ],
    },
    NOW,
  );
  new SqliteMoneyRepo(db).save({
    channelId: cid('A'),
    videoId: vid('A', 0),
    memberships: true,
    ads: 'unknown',
    checkedAt: NOW,
  });
  return db;
}

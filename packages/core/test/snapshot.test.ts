import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { listBreakouts } from '../src/map/breakouts';
import { loadMapSnapshot, type SnapshotDeps } from '../src/map/snapshot';
import type { MapMemberData } from '../src/map/view';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteEdgeRepo } from '../src/repos/sqliteEdgeRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { StoredChannel, StoredVideo } from '../src/repos/types';
import type { StorableVideo } from '../src/sources/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (letter: string, n: number) => `${letter}`.repeat(10) + String(n);

const storable = (letter: string, n: number, views: number, daysAgo: number): StorableVideo => ({
  id: vid(letter, n),
  channelId: cid(letter),
  title: `${letter} video ${n}`,
  views,
  durationSeconds: 600 + n,
  published: {
    date: new Date(NOW.getTime() - daysAgo * DAY_MS),
    precision: 'day',
    raw: `${daysAgo}d ago`,
  },
});

const stored = (letter: string, n: number, views: number, daysAgo: number): StoredVideo => ({
  ...storable(letter, n, views, daysAgo),
  fetchedAt: NOW,
});

const channel = (letter: string, subscribers: number | null): StoredChannel => ({
  id: cid(letter),
  title: `Channel ${letter}`,
  handle: `handle${letter}`,
  subscribers,
  subscribersHidden: subscribers === null,
  videoCount: 4,
  fetchedAt: NOW,
});

/** Four videos: one hit and three ordinary ones, so the hit scores about `multiple`×. */
const withHit = (letter: string, multiple: number, hitAge = 10): StoredVideo[] => [
  stored(letter, 1, 1000 * multiple, hitAge),
  stored(letter, 2, 1000, 20),
  stored(letter, 3, 1000, 25),
  stored(letter, 4, 1000, 28),
];

describe('listBreakouts', () => {
  const member = (letter: string, videos: StoredVideo[], subscribers = 5000): MapMemberData => ({
    channel: channel(letter, subscribers),
    steps: 1,
    videos,
  });

  test('ranks recent videos across channels by how far they beat their usual', () => {
    const feed = listBreakouts([member('A', withHit('A', 20)), member('B', withHit('B', 80))], NOW);

    expect(feed.map((item) => item.videoId)).toEqual([vid('B', 1), vid('A', 1)]);
    expect(feed[0]).toMatchObject({
      channelId: cid('B'),
      channelTitle: 'Channel B',
      channelSubscribers: 5000,
      title: 'B video 1',
      views: 80_000,
      durationSeconds: 601,
      publishedRaw: '10d ago',
    });
    expect(feed[0]?.score).toBeGreaterThan(70);
  });

  test('leaves out ordinary videos and ones older than the window', () => {
    const feed = listBreakouts(
      [member('A', withHit('A', 20, 45)), member('B', withHit('B', 1.2))],
      NOW,
    );

    expect(feed).toEqual([]);
  });

  test('honours the limit', () => {
    const members = ['A', 'B', 'D'].map((letter) => member(letter, withHit(letter, 30)));

    expect(listBreakouts(members, NOW, { limit: 2 })).toHaveLength(2);
  });
});

describe('loadMapSnapshot', () => {
  let deps: SnapshotDeps;

  beforeEach(() => {
    const db = openDatabase(':memory:');
    deps = {
      channels: new SqliteChannelRepo(db),
      videos: new SqliteVideoRepo(db),
      edges: new SqliteEdgeRepo(db),
      maps: new SqliteMapRepo(db),
    };
    deps.channels.upsert(channel('C', null), NOW);
    deps.channels.upsert(channel('A', 900), NOW);
    deps.channels.upsert(channel('B', 400_000), NOW);
    deps.videos.upsertMany([storable('C', 1, 50, 2)], NOW);
    deps.videos.upsertMany(
      [
        storable('A', 1, 40_000, 10),
        storable('A', 2, 1000, 20),
        storable('A', 3, 1000, 25),
        storable('A', 4, 1000, 28),
      ],
      NOW,
    );
    deps.edges.replaceFrom(
      cid('C'),
      [
        { fromChannelId: cid('C'), toChannelId: cid('A'), hits: 7, sampled: 10, share: 0.7 },
        { fromChannelId: cid('C'), toChannelId: cid('B'), hits: 2, sampled: 10, share: 0.2 },
      ],
      'US',
      NOW,
    );
  });

  const saveMap = () =>
    deps.maps.create(
      {
        centerChannelId: cid('C'),
        depth: 2,
        region: 'US',
        members: [
          { channelId: cid('C'), steps: 0 },
          { channelId: cid('A'), steps: 1 },
          { channelId: cid('B'), steps: 1 },
        ],
      },
      NOW,
    );

  test('returns null when the channel has no saved map', () => {
    expect(loadMapSnapshot(deps, cid('C'), NOW)).toBeNull();
  });

  test('describes the map with plain values ready to send to the browser', () => {
    const mapId = saveMap();

    const snapshot = loadMapSnapshot(deps, cid('C'), NOW);

    expect(snapshot).toMatchObject({
      mapId,
      depth: 2,
      region: 'US',
      createdAt: '2026-11-20T12:00:00.000Z',
      center: { id: cid('C'), title: 'Channel C', handle: 'handleC', subscribers: null },
    });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  test('lists each channel with its tier, link to the centre and best breakout', () => {
    saveMap();

    const snapshot = loadMapSnapshot(deps, cid('C'), NOW);

    expect(snapshot?.channels.map((c) => c.title)).toEqual(['Channel A', 'Channel B']);
    expect(snapshot?.channels[0]).toMatchObject({
      id: cid('A'),
      steps: 1,
      tier: 'close',
      centerShare: 0.7,
      subscribers: 900,
      recentViews: 43_000,
      rising: true,
    });
    expect(snapshot?.channels[0]?.breakout?.videoId).toBe(vid('A', 1));
    expect(snapshot?.channels[1]).toMatchObject({
      tier: 'medium',
      centerShare: 0.2,
      breakout: null,
    });
  });

  test('includes the edges between members and the breakout feed', () => {
    saveMap();

    const snapshot = loadMapSnapshot(deps, cid('C'), NOW);

    expect(snapshot?.edges).toEqual([
      { from: cid('C'), to: cid('A'), share: 0.7 },
      { from: cid('C'), to: cid('B'), share: 0.2 },
    ]);
    expect(snapshot?.breakouts.map((item) => item.videoId)).toEqual([vid('A', 1)]);
  });
});

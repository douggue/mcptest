import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { listBreakouts } from '../src/map/breakouts';
import {
  SNAPSHOT_FORMAT,
  freezeMapSnapshot,
  loadMapSnapshot,
  type SnapshotDeps,
} from '../src/map/snapshot';
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

  test('carries the evidence behind each score', () => {
    const [hit] = listBreakouts([member('A', withHit('A', 20))], NOW);

    expect(hit).toMatchObject({
      baseline: 1000,
      sampleSize: 3,
      channelHits: 1,
      channelScored: 4,
      caution: 'few-videos',
    });
    expect(hit?.channelAgeDays).toBeCloseTo(28, 0);
  });

  test('trusts a score built on enough videos with real view counts, and no other', () => {
    const many = (letter: string, usual: number): StoredVideo[] => [
      stored(letter, 0, usual * 30, 5),
      ...[1, 2, 3, 4, 5, 6].map((n) => stored(letter, n, usual, 10 + n)),
    ];

    const feed = listBreakouts([member('A', many('A', 1000)), member('B', many('B', 40))], NOW);

    expect(feed.map((item) => [item.channelTitle, item.sampleSize, item.caution])).toEqual([
      ['Channel A', 6, null],
      ['Channel B', 6, 'low-baseline'],
    ]);
  });

  test('does not guess a channel age when older videos may not have been read', () => {
    const capped = [
      stored('A', 0, 90_000, 5),
      ...Array.from({ length: 99 }, (_, n) => stored('A', n + 1, 1000, 6 + n)),
    ];

    expect(listBreakouts([member('A', capped)], NOW)[0]?.channelAgeDays).toBeNull();
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

  test('keeps showing a frozen map as it was, whatever is stored later', () => {
    saveMap();
    freezeMapSnapshot(deps, cid('C'), NOW);
    deps.videos.upsertMany([storable('A', 1, 900_000, 10)], new Date(NOW.getTime() + DAY_MS));

    const snapshot = loadMapSnapshot(deps, cid('C'), new Date(NOW.getTime() + DAY_MS));

    expect(snapshot?.channels[0]?.recentViews).toBe(43_000);
  });

  test.each([
    ['is not JSON', () => '{not json'],
    [
      'has no format number',
      (id: number) => JSON.stringify({ mapId: id, channels: [], breakouts: [] }),
    ],
    [
      'holds entries of the wrong shape',
      (id: number) =>
        JSON.stringify({
          format: SNAPSHOT_FORMAT,
          snapshot: { mapId: id, channels: [null], breakouts: [{}], edges: [] },
        }),
    ],
    [
      'belongs to another map',
      () =>
        JSON.stringify({
          format: SNAPSHOT_FORMAT,
          snapshot: { mapId: 999, channels: [], breakouts: [], edges: [] },
        }),
    ],
  ])('rebuilds from current data when the stored copy %s', (_what, stored) => {
    const mapId = saveMap();
    deps.maps.saveSnapshot(mapId, stored(mapId));

    expect(loadMapSnapshot(deps, cid('C'), NOW)?.channels).toHaveLength(2);
  });

  test('marks a removed channel and drops its videos from the feed, until it is restored', () => {
    saveMap();
    freezeMapSnapshot(deps, cid('C'), NOW);
    deps.maps.setRemoved(cid('C'), cid('A'), true, NOW);

    const removed = loadMapSnapshot(deps, cid('C'), NOW);
    expect(removed?.channels.map((c) => [c.title, c.removed])).toEqual([
      ['Channel A', true],
      ['Channel B', false],
    ]);
    expect(removed?.breakouts).toEqual([]);

    deps.maps.setRemoved(cid('C'), cid('A'), false, NOW);
    expect(loadMapSnapshot(deps, cid('C'), NOW)?.breakouts).toHaveLength(1);
  });

  test('keeps a removal when a new map is made for the same channel', () => {
    saveMap();
    deps.maps.setRemoved(cid('C'), cid('A'), true, NOW);
    saveMap();

    expect(loadMapSnapshot(deps, cid('C'), NOW)?.channels[0]?.removed).toBe(true);
  });
});

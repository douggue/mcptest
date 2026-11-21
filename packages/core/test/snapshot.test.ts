import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import {
  DEFAULT_BREAKOUT_LIMIT,
  MAX_BREAKOUTS_PER_CHANNEL,
  capPerChannel,
  listBreakouts,
} from '../src/map/breakouts';
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

  /** A series: `hits` videos of one age, far above the channel's twenty ordinary ones. */
  const series = (letter: string, hits: number, multiple: number): StoredVideo[] => [
    ...Array.from({ length: hits }, (_, n) => stored(letter, n, 1000 * (multiple + n), 5)),
    ...Array.from({ length: 20 }, (_, n) => stored(letter, 50 + n, 1000, 12 + n)),
  ];

  test('lets one channel hold only a few places, and gives the rest to the next strongest', () => {
    const feed = listBreakouts(
      [member('A', series('A', 9, 50)), member('B', series('B', 2, 10))],
      NOW,
      { limit: 6 },
    );

    expect(MAX_BREAKOUTS_PER_CHANNEL).toBe(4);
    // The four strongest of the nine, then the other channel's two, which nine would have crowded out.
    expect(feed.map((item) => item.channelId)).toEqual([
      ...new Array<string>(MAX_BREAKOUTS_PER_CHANNEL).fill(cid('A')),
      cid('B'),
      cid('B'),
    ]);
    expect(feed.slice(0, 4).map((item) => item.videoId)).toEqual(
      [8, 7, 6, 5].map((n) => vid('A', n)),
    );
  });

  test('capPerChannel keeps the order and does not change the list it is given', () => {
    const feed = ['A', 'A', 'B', 'A', 'B'].map((letter, index) => ({
      channelId: cid(letter),
      videoId: `v${index}`,
    }));
    const before = [...feed];

    expect(capPerChannel(feed, 2).map((item) => item.videoId)).toEqual(['v0', 'v1', 'v2', 'v4']);
    expect(feed).toEqual(before);
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

  test('adds each channel’s logo from the store as it is now, and null where none was read', () => {
    saveMap();
    const logo = (letter: string) => ({
      url: `https://yt3.googleusercontent.com/${letter}=s176`,
      width: 176,
      height: 176,
    });
    const brands = {
      find: (id: string) =>
        id === cid('B')
          ? null
          : {
              channelId: id,
              description: null,
              avatar: [logo(id === cid('C') ? 'c' : 'a')],
              banner: [],
              keywords: [],
              links: [],
              fetchedAt: NOW,
            },
    };

    const snapshot = loadMapSnapshot({ ...deps, brands }, cid('C'), NOW);

    expect(snapshot?.center.logoUrl).toBe('https://yt3.googleusercontent.com/c=s176');
    expect(snapshot?.channels.map((c) => [c.title, c.logoUrl])).toEqual([
      ['Channel A', 'https://yt3.googleusercontent.com/a=s176'],
      ['Channel B', null],
    ]);
  });

  test('leaves logos out when no brand store is given', () => {
    saveMap();

    const snapshot = loadMapSnapshot(deps, cid('C'), NOW);

    expect(snapshot?.center.logoUrl).toBeUndefined();
    expect(snapshot?.channels[0]?.logoUrl).toBeUndefined();
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
      group: 'rising',
      ninetyDayViews: 43_000,
      widelySeenUploads: 1,
    });
    expect(snapshot?.channels[0]?.breakout?.videoId).toBe(vid('A', 1));
    expect(snapshot?.channels[1]).toMatchObject({
      tier: 'medium',
      centerShare: 0.2,
      breakout: null,
    });
  });

  test('says for each channel whether its look-alike call is settled', () => {
    saveMap();

    const snapshot = loadMapSnapshot(deps, cid('C'), NOW);

    // Two channels with nothing in common: neither call hangs on the other being there.
    expect(snapshot?.channels.map((entry) => entry.settled)).toEqual([true, true]);
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
      // Format 3: before dormant channels were left out and the feed was limited per channel.
      'was frozen under the earlier peer rules',
      (id: number) =>
        JSON.stringify({
          format: 3,
          snapshot: { mapId: id, center: { id: cid('C') }, channels: [], breakouts: [], edges: [] },
        }),
    ],
    [
      // Format 4: before each call said whether it is settled.
      'does not say which calls are settled',
      (id: number) =>
        JSON.stringify({
          format: 4,
          snapshot: { mapId: id, center: { id: cid('C') }, channels: [], breakouts: [], edges: [] },
        }),
    ],
    [
      // Format 5: before each channel said whether it has taken off or is rising.
      'does not say which group each channel is in',
      (id: number) =>
        JSON.stringify({
          format: 5,
          snapshot: { mapId: id, center: { id: cid('C') }, channels: [], breakouts: [], edges: [] },
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

describe('a channel the owner keeps as a competitor', () => {
  let deps: SnapshotDeps;
  /** Far too large to count as a channel like the centre. */
  const GIANT = 5_000_000;

  beforeEach(() => {
    const db = openDatabase(':memory:');
    deps = {
      channels: new SqliteChannelRepo(db),
      videos: new SqliteVideoRepo(db),
      edges: new SqliteEdgeRepo(db),
      maps: new SqliteMapRepo(db),
    };
    deps.channels.upsert(channel('C', 1000), NOW);
    deps.channels.upsert(channel('A', 900), NOW);
    deps.channels.upsert(channel('X', GIANT), NOW);
    deps.videos.upsertMany(
      [1, 2, 3, 4].map((n) => storable('C', n, 1000, 5 * n)),
      NOW,
    );
    deps.videos.upsertMany(
      withHit('A', 20).map((video) => storable('A', Number(video.id.slice(-1)), video.views, 10)),
      NOW,
    );
    deps.videos.upsertMany(
      [storable('X', 1, 90_000, 10), ...[2, 3, 4].map((n) => storable('X', n, 1000, 15 + n))],
      NOW,
    );
    deps.maps.create(
      {
        centerChannelId: cid('C'),
        depth: 2,
        region: 'US',
        members: [
          { channelId: cid('C'), steps: 0 },
          { channelId: cid('X'), steps: 1 },
          { channelId: cid('A'), steps: 1 },
        ],
      },
      NOW,
    );
  });

  const load = () => loadMapSnapshot(deps, cid('C'), NOW);
  const find = (letter: string) => load()?.channels.find((entry) => entry.id === cid(letter));
  const feedOf = (letter: string) =>
    load()?.breakouts.filter((video) => video.channelId === cid(letter)) ?? [];

  test('is an outsider until the owner says otherwise', () => {
    freezeMapSnapshot(deps, cid('C'), NOW);

    expect(find('X')).toMatchObject({ peer: false, kept: false, outsideReason: 'larger' });
    expect(feedOf('X').map((video) => video.peer)).toEqual([false]);
  });

  test('counts as a peer on a frozen map, and still says why the filter left it out', () => {
    freezeMapSnapshot(deps, cid('C'), NOW);
    deps.maps.setKept(cid('C'), cid('X'), true, NOW);

    expect(find('X')).toMatchObject({
      peer: true,
      kept: true,
      removed: false,
      outsideReason: 'larger',
    });
    expect(find('A')).toMatchObject({ kept: false });
  });

  test('has its videos treated as peer videos in the breakout feed', () => {
    freezeMapSnapshot(deps, cid('C'), NOW);
    deps.maps.setKept(cid('C'), cid('X'), true, NOW);

    const feed = load()?.breakouts ?? [];

    expect(feedOf('X')).toEqual([
      expect.objectContaining({ videoId: vid('X', 1), peer: true, channelSubscribers: GIANT }),
    ]);
    expect(feed.filter((video) => video.videoId === vid('X', 1))).toHaveLength(1);
    const peers = feed.filter((video) => video.peer);
    expect(peers.map((video) => video.score)).toEqual(
      [...peers.map((video) => video.score)].sort((a, b) => b - a),
    );
  });

  test('brings in videos the frozen feed had no room for', () => {
    const mapId = deps.maps.latestForCenter(cid('C'))?.id ?? 0;
    freezeMapSnapshot(deps, cid('C'), NOW);
    const frozen = JSON.parse(deps.maps.findSnapshot(mapId) ?? '{}') as {
      snapshot: { breakouts: Array<{ channelId: string }> };
    };
    frozen.snapshot.breakouts = frozen.snapshot.breakouts.filter(
      (video) => video.channelId !== cid('X'),
    );
    deps.maps.saveSnapshot(mapId, JSON.stringify(frozen));
    expect(feedOf('X')).toEqual([]);

    deps.maps.setKept(cid('C'), cid('X'), true, NOW);

    expect(feedOf('X').map((video) => [video.videoId, video.peer])).toEqual([[vid('X', 1), true]]);
  });

  test('fills the feed with the next videos when a removed channel held some of its places', () => {
    const mapId = deps.maps.latestForCenter(cid('C'))?.id ?? 0;
    freezeMapSnapshot(deps, cid('C'), NOW);
    const frozen = JSON.parse(deps.maps.findSnapshot(mapId) ?? '{}') as {
      snapshot: { breakouts: Array<Record<string, unknown>> };
    };
    const template = frozen.snapshot.breakouts[0] ?? {};
    // A full frozen feed of peers' videos, the strongest five from a channel the owner then removes.
    frozen.snapshot.breakouts = Array.from({ length: DEFAULT_BREAKOUT_LIMIT }, (_, index) => ({
      ...template,
      videoId: `frozen${String(index).padStart(5, '0')}`,
      // Five from the channel to be removed, the rest from as many other channels.
      channelId: index < 5 ? cid('R') : `UC${String(index).padStart(22, '0')}`,
      score: 10_000 - index,
      peer: true,
    }));
    deps.maps.saveSnapshot(mapId, JSON.stringify(frozen));
    deps.maps.setRemoved(cid('C'), cid('R'), true, NOW);
    deps.maps.setKept(cid('C'), cid('X'), true, NOW);

    const peers = (load()?.breakouts ?? []).filter((video) => video.peer);

    expect(peers.some((video) => video.channelId === cid('R'))).toBe(false);
    // The kept channel's video scores lowest; it is in because the removed five made room.
    expect(peers.at(-1)?.videoId).toBe(vid('X', 1));
    expect(peers).toHaveLength(DEFAULT_BREAKOUT_LIMIT - 5 + 1);
  });

  test('still cuts the feed to its limit after the removed channels are taken out', () => {
    const mapId = deps.maps.latestForCenter(cid('C'))?.id ?? 0;
    freezeMapSnapshot(deps, cid('C'), NOW);
    const frozen = JSON.parse(deps.maps.findSnapshot(mapId) ?? '{}') as {
      snapshot: { breakouts: Array<Record<string, unknown>> };
    };
    const template = frozen.snapshot.breakouts[0] ?? {};
    frozen.snapshot.breakouts = Array.from({ length: DEFAULT_BREAKOUT_LIMIT }, (_, index) => ({
      ...template,
      videoId: `frozen${String(index).padStart(5, '0')}`,
      channelId: `UC${String(index).padStart(22, '0')}`,
      score: 10_000 - index,
      peer: true,
    }));
    deps.maps.saveSnapshot(mapId, JSON.stringify(frozen));
    deps.maps.setKept(cid('C'), cid('X'), true, NOW);

    const peers = (load()?.breakouts ?? []).filter((video) => video.peer);

    expect(peers).toHaveLength(DEFAULT_BREAKOUT_LIMIT);
    expect(peers.some((video) => video.channelId === cid('X'))).toBe(false);
  });

  test('cuts a channel down to its few places in a feed frozen before there was a limit', () => {
    const mapId = deps.maps.latestForCenter(cid('C'))?.id ?? 0;
    freezeMapSnapshot(deps, cid('C'), NOW);
    const frozen = JSON.parse(deps.maps.findSnapshot(mapId) ?? '{}') as {
      snapshot: { breakouts: Array<Record<string, unknown>> };
    };
    const template = frozen.snapshot.breakouts[0] ?? {};
    // One channel's series holds seventeen places, as it did on the owner's map.
    frozen.snapshot.breakouts = Array.from({ length: 20 }, (_, index) => ({
      ...template,
      videoId: `frozen${String(index).padStart(5, '0')}`,
      channelId: index < 17 ? cid('A') : `UC${String(index).padStart(22, '0')}`,
      score: 10_000 - index,
      peer: true,
    }));
    deps.maps.saveSnapshot(mapId, JSON.stringify(frozen));

    const feed = load()?.breakouts ?? [];

    expect(feed.filter((video) => video.channelId === cid('A')).map((v) => v.videoId)).toEqual(
      [0, 1, 2, 3].map((index) => `frozen${String(index).padStart(5, '0')}`),
    );
    expect(feed).toHaveLength(MAX_BREAKOUTS_PER_CHANNEL + 3);
  });

  test('stays in the order of the map: channels like the centre first', () => {
    freezeMapSnapshot(deps, cid('C'), NOW);
    const before = load()?.channels.map((entry) => [entry.title, entry.peer]);
    deps.maps.setKept(cid('C'), cid('X'), true, NOW);

    const after = load()?.channels ?? [];

    expect(before?.at(-1)).toEqual(['Channel X', false]);
    expect(after.map((entry) => entry.peer)).toEqual(after.map(() => true));
    expect(after.at(-1)?.title).toBe('Channel X');
  });

  test('stays kept when a new map is made for the same channel, until it is undone', () => {
    deps.maps.setKept(cid('C'), cid('X'), true, NOW);
    deps.maps.create(
      {
        centerChannelId: cid('C'),
        depth: 1,
        region: 'US',
        members: [
          { channelId: cid('C'), steps: 0 },
          { channelId: cid('X'), steps: 1 },
        ],
      },
      new Date(NOW.getTime() + DAY_MS),
    );

    expect(find('X')).toMatchObject({ peer: true, kept: true });

    deps.maps.setKept(cid('C'), cid('X'), false, NOW);
    expect(find('X')).toMatchObject({ peer: false, kept: false });
    expect(feedOf('X').map((video) => video.peer)).toEqual([false]);
  });

  test('is not kept once the owner removes it instead', () => {
    deps.maps.setKept(cid('C'), cid('X'), true, NOW);
    deps.maps.setRemoved(cid('C'), cid('X'), true, NOW);

    expect(find('X')).toMatchObject({ peer: false, kept: false, removed: true });
    expect(feedOf('X')).toEqual([]);
  });

  test('reads a copy frozen before channels could be kept', () => {
    const mapId = deps.maps.latestForCenter(cid('C'))?.id ?? 0;
    freezeMapSnapshot(deps, cid('C'), NOW);
    const frozen = JSON.parse(deps.maps.findSnapshot(mapId) ?? '{}') as {
      snapshot: { channels: Array<{ kept?: boolean }> };
    };
    frozen.snapshot.channels = frozen.snapshot.channels.map(({ kept: _kept, ...rest }) => rest);
    deps.maps.saveSnapshot(mapId, JSON.stringify(frozen));

    expect(load()?.channels.map((entry) => entry.kept)).toEqual([false, false]);
  });
});

describe('the look-alikes of a stored map', () => {
  let deps: SnapshotDeps;

  /** Four uploads inside the last three months and one long before: an established channel. */
  const established = (letter: string, views: number): StorableVideo[] => [
    ...[5, 10, 15, 20].map((daysAgo, n) => storable(letter, n + 1, views, daysAgo)),
    storable(letter, 5, views, 200),
  ];

  beforeEach(() => {
    const db = openDatabase(':memory:');
    deps = {
      channels: new SqliteChannelRepo(db),
      videos: new SqliteVideoRepo(db),
      edges: new SqliteEdgeRepo(db),
      maps: new SqliteMapRepo(db),
    };
    deps.channels.upsert(channel('C', 1000), NOW);
    deps.videos.upsertMany(established('C', 1000), NOW);
    for (const letter of ['T', 'U', 'V']) {
      deps.channels.upsert(channel(letter, 5000), NOW);
      deps.videos.upsertMany(established(letter, 40_000), NOW);
    }
    deps.channels.upsert(channel('R', 900), NOW);
    deps.videos.upsertMany(
      [1, 2, 3, 4].map((n) => storable('R', n, 12_000, 5 * n)),
      NOW,
    );
    deps.channels.upsert(channel('N', 5000), NOW);
    deps.videos.upsertMany(established('N', 100), NOW);
    deps.channels.upsert(channel('X', 5_000_000), NOW);
    deps.videos.upsertMany(established('X', 2_000_000), NOW);
    deps.maps.create(
      {
        centerChannelId: cid('C'),
        depth: 2,
        region: 'US',
        members: ['C', 'N', 'R', 'T', 'U', 'V', 'X'].map((letter) => ({
          channelId: cid(letter),
          steps: letter === 'C' ? 0 : 1,
        })),
      },
      NOW,
    );
  });

  const peers = () =>
    (loadMapSnapshot(deps, cid('C'), NOW)?.channels ?? []).filter((entry) => entry.peer);
  const groups = () => peers().map((entry) => `${entry.title.slice(-1)}:${entry.group}`);

  test('come about seven taken off to three rising, with the rest last', () => {
    expect(groups()).toEqual([
      'T:taken-off',
      'R:rising',
      'U:taken-off',
      'V:taken-off',
      'N:neither',
    ]);
  });

  test('keep that order on a frozen copy, with each channel’s group stored', () => {
    freezeMapSnapshot(deps, cid('C'), NOW);

    expect(groups()).toEqual([
      'T:taken-off',
      'R:rising',
      'U:taken-off',
      'V:taken-off',
      'N:neither',
    ]);
  });

  test('are mixed again without a channel the owner removed, which is listed after them', () => {
    freezeMapSnapshot(deps, cid('C'), NOW);
    deps.maps.setRemoved(cid('C'), cid('T'), true, NOW);

    expect(peers().map((entry) => [entry.title.slice(-1), entry.removed])).toEqual([
      ['U', false],
      ['R', false],
      ['V', false],
      ['N', false],
      ['T', true],
    ]);
  });

  test('take in a channel the owner kept, in its own group', () => {
    freezeMapSnapshot(deps, cid('C'), NOW);
    deps.maps.setKept(cid('C'), cid('X'), true, NOW);

    expect(groups()).toEqual([
      'T:taken-off',
      'R:rising',
      'U:taken-off',
      'V:taken-off',
      'X:taken-off',
      'N:neither',
    ]);
  });
});

import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { freezeMapSnapshot, type SnapshotDeps } from '../src/map/snapshot';
import {
  ORDINARY_MAX_SCORE,
  WINNER_MIN_SCORE,
  buildThumbnailBoard,
  loadThumbnailBoard,
  type BoardSource,
} from '../src/map/thumbnails';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteEdgeRepo } from '../src/repos/sqliteEdgeRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { StoredChannel, StoredVideo } from '../src/repos/types';
import type { StorableVideo } from '../src/sources/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const USUAL_VIEWS = 1000;
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (letter: string, n: number) => letter.repeat(9) + String(n).padStart(2, '0');

const storable = (letter: string, n: number, views: number, daysAgo: number): StorableVideo => ({
  id: vid(letter, n),
  channelId: cid(letter),
  title: `America Just Built Thing ${letter}${n}`,
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

const source = (
  letter: string,
  videos: readonly StoredVideo[],
  subscribers = 5000,
): BoardSource => ({
  id: cid(letter),
  title: `Channel ${letter}`,
  subscribers,
  videos,
});

/**
 * Seven videos old enough for their views to have settled: two clear hits, one a
 * little above usual, and four at the channel's usual views.
 */
const mixed = (letter: string): StoredVideo[] => [
  stored(letter, 1, USUAL_VIEWS * 10, 30),
  stored(letter, 2, USUAL_VIEWS * 40, 40),
  stored(letter, 3, USUAL_VIEWS * 1.6, 35),
  stored(letter, 4, USUAL_VIEWS, 20),
  stored(letter, 5, USUAL_VIEWS, 45),
  stored(letter, 6, USUAL_VIEWS, 25),
  stored(letter, 7, USUAL_VIEWS, 50),
];

const board = (peers: readonly BoardSource[], center = source('C', [])) =>
  buildThumbnailBoard({ mapId: 1, center, peers }, NOW);

describe('buildThumbnailBoard', () => {
  test('lists a channel’s winners strongest first', () => {
    const [channel] = board([source('A', mixed('A'))]).channels;

    expect(channel?.winners.map((video) => video.videoId)).toEqual([vid('A', 2), vid('A', 1)]);
    expect(channel?.winners[0]?.score).toBeGreaterThan(channel?.winners[1]?.score ?? 0);
    expect(channel?.winners.every((video) => video.score >= WINNER_MIN_SCORE)).toBe(true);
  });

  test('lists its ordinary videos newest first, leaving out the ones in between', () => {
    const [channel] = board([source('A', mixed('A'))]).channels;

    expect(channel?.ordinary.map((video) => video.videoId)).toEqual([
      vid('A', 4),
      vid('A', 6),
      vid('A', 5),
      vid('A', 7),
    ]);
    expect(channel?.ordinary.every((video) => video.score <= ORDINARY_MAX_SCORE)).toBe(true);
  });

  test('describes each video and its channel with what a reader needs to find it again', () => {
    const [channel] = board([source('A', mixed('A'), 2190)]).channels;

    expect(channel).toMatchObject({ id: cid('A'), title: 'Channel A', subscribers: 2190 });
    expect(channel?.winners[0]).toMatchObject({
      videoId: vid('A', 2),
      title: 'America Just Built Thing A2',
      views: 40_000,
      publishedRaw: '40d ago',
      durationSeconds: 602,
    });
    expect(channel?.winners[0]?.ageDays).toBeCloseTo(40, 5);
  });

  test('counts how often the channel wins, beyond the few it shows', () => {
    const [channel] = buildThumbnailBoard(
      { mapId: 1, center: source('C', []), peers: [source('A', mixed('A'))] },
      NOW,
      { winnersPerChannel: 1, ordinaryPerChannel: 2 },
    ).channels;

    expect(channel?.winners).toHaveLength(1);
    expect(channel?.ordinary).toHaveLength(2);
    expect(channel).toMatchObject({ winnerCount: 2, scoredCount: 7 });
  });

  test('does not call a video ordinary before it has had a few days to be found', () => {
    const videos = [...mixed('A'), stored('A', 8, 5, 1)];

    const [channel] = board([source('A', videos)]).channels;

    expect(channel?.ordinary.map((video) => video.videoId)).not.toContain(vid('A', 8));
  });

  test('keeps a channel with nothing to show, with empty lists', () => {
    const quiet = [stored('B', 1, USUAL_VIEWS, 20), stored('B', 2, USUAL_VIEWS, 30)];

    const { channels } = board([source('B', quiet), source('D', [])]);

    expect(channels.map((channel) => [channel.id, channel.winners, channel.ordinary])).toEqual([
      [cid('B'), [], []],
      [cid('D'), [], []],
    ]);
    expect(channels[0]).toMatchObject({ winnerCount: 0, scoredCount: 0 });
  });

  test('keeps the channels in the order given', () => {
    const { channels } = board([source('B', mixed('B')), source('A', mixed('A'))]);

    expect(channels.map((channel) => channel.id)).toEqual([cid('B'), cid('A')]);
  });

  test('shows the centre’s own videos newest first, scored or not', () => {
    const own = [stored('C', 1, 64, 7), stored('C', 2, 57, 9), stored('C', 3, 9, 1)];

    const { center } = board([], source('C', own, 12));

    expect(center).toMatchObject({ id: cid('C'), title: 'Channel C', subscribers: 12 });
    expect(center.videos.map((video) => [video.videoId, video.score])).toEqual([
      [vid('C', 3), null],
      [vid('C', 1), null],
      [vid('C', 2), null],
    ]);
  });

  test('scores the centre’s own videos once it has enough of them, and caps the list', () => {
    const { center } = buildThumbnailBoard(
      { mapId: 1, center: source('C', mixed('C')), peers: [] },
      NOW,
      { ownVideos: 3 },
    );

    expect(center.videos.map((video) => video.videoId)).toEqual([
      vid('C', 4),
      vid('C', 6),
      vid('C', 1),
    ]);
    expect(center.videos[2]?.score).toBeGreaterThan(WINNER_MIN_SCORE);
  });

  test('says which scores it treated as winning and as ordinary', () => {
    expect(board([])).toMatchObject({
      mapId: 1,
      winnerMinScore: WINNER_MIN_SCORE,
      ordinaryMaxScore: ORDINARY_MAX_SCORE,
    });
  });

  test('leaves what it was given untouched', () => {
    const videos = Object.freeze(mixed('A').map((video) => Object.freeze(video)));
    const peers = Object.freeze([Object.freeze(source('A', videos))]);

    expect(() => board(peers)).not.toThrow();
    expect(videos.map((video) => video.id)).toEqual(mixed('A').map((video) => video.id));
  });
});

describe('loadThumbnailBoard', () => {
  let deps: SnapshotDeps;

  const channel = (letter: string, subscribers: number | null): StoredChannel => ({
    id: cid(letter),
    title: `Channel ${letter}`,
    handle: `handle${letter}`,
    subscribers,
    subscribersHidden: subscribers === null,
    videoCount: 7,
    fetchedAt: NOW,
  });
  const storeVideos = (letter: string) =>
    deps.videos.upsertMany(
      mixed(letter).map((video) => ({ ...video })),
      NOW,
    );

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
    deps.channels.upsert(channel('B', 2000), NOW);
    // Far too large to be a channel like the centre.
    deps.channels.upsert(channel('X', 9_000_000), NOW);
    deps.videos.upsertMany([storable('C', 1, 50, 2), storable('C', 2, 70, 9)], NOW);
    for (const letter of ['A', 'B', 'X']) storeVideos(letter);
    deps.edges.replaceFrom(
      cid('C'),
      ['A', 'B', 'X'].map((letter) => ({
        fromChannelId: cid('C'),
        toChannelId: cid(letter),
        hits: 5,
        sampled: 10,
        share: 0.5,
      })),
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
          { channelId: cid('X'), steps: 1 },
        ],
      },
      NOW,
    );

  test('returns null when the channel has no saved map', () => {
    expect(loadThumbnailBoard(deps, cid('C'), NOW)).toBeNull();
  });

  test('covers the channels like the centre and leaves the others out', () => {
    const mapId = saveMap();

    const found = loadThumbnailBoard(deps, cid('C'), NOW);

    expect(found?.mapId).toBe(mapId);
    expect(found?.channels.map((entry) => entry.id).sort()).toEqual([cid('A'), cid('B')]);
    expect(found?.channels[0]?.winners.map((video) => video.videoId)).toHaveLength(2);
    expect(found?.channels[0]?.ordinary).toHaveLength(4);
  });

  test('shows the centre’s own stored videos, newest first', () => {
    saveMap();

    const found = loadThumbnailBoard(deps, cid('C'), NOW);

    expect(found?.center).toMatchObject({ id: cid('C'), title: 'Channel C', subscribers: null });
    expect(found?.center.videos.map((video) => video.videoId)).toEqual([vid('C', 1), vid('C', 2)]);
  });

  test('leaves out a channel the owner removed, until it is restored', () => {
    saveMap();
    deps.maps.setRemoved(cid('C'), cid('A'), true, NOW);

    expect(loadThumbnailBoard(deps, cid('C'), NOW)?.channels.map((entry) => entry.id)).toEqual([
      cid('B'),
    ]);

    deps.maps.setRemoved(cid('C'), cid('A'), false, NOW);
    expect(loadThumbnailBoard(deps, cid('C'), NOW)?.channels).toHaveLength(2);
  });

  test('adds a channel the owner kept as a competitor, after the ones like the centre', () => {
    saveMap();
    freezeMapSnapshot(deps, cid('C'), NOW);
    deps.maps.setKept(cid('C'), cid('X'), true, NOW);

    const kept = loadThumbnailBoard(deps, cid('C'), NOW);

    expect(kept?.channels).toHaveLength(3);
    expect(kept?.channels.at(-1)).toMatchObject({ id: cid('X'), subscribers: 9_000_000 });
    expect(kept?.channels.at(-1)?.winners).toHaveLength(2);

    deps.maps.setKept(cid('C'), cid('X'), false, NOW);
    expect(loadThumbnailBoard(deps, cid('C'), NOW)?.channels).toHaveLength(2);
  });

  test('reads videos as stored now, for the peers of the map as it was frozen', () => {
    saveMap();
    freezeMapSnapshot(deps, cid('C'), NOW);
    const later = new Date(NOW.getTime() + DAY_MS);
    deps.videos.upsertMany([storable('A', 4, USUAL_VIEWS * 90, 20)], later);

    const found = loadThumbnailBoard(deps, cid('C'), later);

    const peer = found?.channels.find((entry) => entry.id === cid('A'));
    expect(peer?.winners[0]?.videoId).toBe(vid('A', 4));
  });

  test('is made of plain values ready to send to the browser', () => {
    saveMap();

    const found = loadThumbnailBoard(deps, cid('C'), NOW);

    expect(JSON.parse(JSON.stringify(found))).toEqual(found);
  });

  test('honours the limits it is given', () => {
    saveMap();

    const found = loadThumbnailBoard(deps, cid('C'), NOW, { winnersPerChannel: 1 });

    expect(found?.channels.every((entry) => entry.winners.length === 1)).toBe(true);
  });
});

import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { PEER_MIN_TITLE_MATCH } from '../src/map/peers';
import {
  SAME_TOPIC_TITLES_SHOWN,
  buildSameTopicList,
  loadSameTopicList,
} from '../src/map/sameTopic';
import type { MapSnapshot, SnapshotChannel, SnapshotDeps } from '../src/map/snapshot';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteEdgeRepo } from '../src/repos/sqliteEdgeRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { StoredVideo } from '../src/repos/types';
import type { StorableVideo } from '../src/sources/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (letter: string, n: number) => letter.repeat(10) + String(n);

const storable = (letter: string, n: number, title: string, daysAgo = n): StorableVideo => ({
  id: vid(letter, n),
  channelId: cid(letter),
  title,
  views: 1000 * n,
  durationSeconds: 900,
  published: {
    date: new Date(NOW.getTime() - daysAgo * DAY_MS),
    precision: 'day',
    raw: `${daysAgo}d ago`,
  },
});

/** Five English titles for a channel, newest first. */
const videosOf = (letter: string, title = `How ${letter} was built, part`): StoredVideo[] =>
  [1, 2, 3, 4, 5].map((n) => ({ ...storable(letter, n, `${title} ${n}`), fetchedAt: NOW }));

const entry = (letter: string, overrides: Partial<SnapshotChannel> = {}): SnapshotChannel => ({
  id: cid(letter),
  title: `Channel ${letter}`,
  handle: `handle${letter}`,
  subscribers: 5000,
  steps: 1,
  tier: 'medium',
  relevance: 0.1,
  centerShare: null,
  recentViews: 40_000,
  recentUploads: 4,
  rising: false,
  breakout: { videoId: vid(letter, 1), title: 'A hit', views: 30_000, score: 12 },
  recommendedBy: [],
  peer: false,
  outsideReason: 'titles',
  removed: false,
  kept: false,
  ...overrides,
});

const mapOf = (channels: readonly SnapshotChannel[]): MapSnapshot => ({
  mapId: 7,
  depth: 2,
  region: 'US',
  createdAt: NOW.toISOString(),
  center: { id: cid('C'), title: 'Centre', handle: 'centre', subscribers: 800, storedVideos: 5 },
  model: null,
  channels,
  edges: [],
  breakouts: [],
});

const stored = new Map(['C', 'A', 'B', 'D', 'E', 'F'].map((l) => [cid(l), videosOf(l)]));
const read = (channelId: string): readonly StoredVideo[] => stored.get(channelId) ?? [];

describe('buildSameTopicList', () => {
  test('lists only the channels the filter left out on titles alone, strongest match first', () => {
    const list = buildSameTopicList(
      mapOf([
        entry('P', { peer: true, outsideReason: null, relevance: 0.6 }),
        entry('A', { relevance: 0.08 }),
        entry('B', { relevance: 0.13 }),
        entry('L', { outsideReason: 'larger', relevance: 0.5 }),
        entry('N', { outsideReason: 'length' }),
        entry('Q', { outsideReason: 'cadence' }),
        entry('D', { relevance: 0.11 }),
      ]),
      read,
    );

    expect(list.channels.map((channel) => channel.title)).toEqual([
      'Channel B',
      'Channel D',
      'Channel A',
    ]);
    expect(list).toMatchObject({
      mapId: 7,
      centerId: cid('C'),
      minTitleMatch: PEER_MIN_TITLE_MATCH,
    });
  });

  test('gives each channel its size, title match, recent views, best breakout and newest titles', () => {
    const [channel] = buildSameTopicList(mapOf([entry('A', { relevance: 0.12 })]), read).channels;

    expect(channel).toEqual({
      id: cid('A'),
      title: 'Channel A',
      handle: 'handleA',
      subscribers: 5000,
      titleMatch: 0.12,
      recentViews: 40_000,
      recentUploads: 4,
      breakout: { videoId: vid('A', 1), title: 'A hit', views: 30_000, score: 12 },
      recentTitles: [1, 2, 3, 4].map((n) => ({
        videoId: vid('A', n),
        title: `How A was built, part ${n}`,
        views: 1000 * n,
        publishedRaw: `${n}d ago`,
      })),
    });
    expect(channel?.recentTitles).toHaveLength(SAME_TOPIC_TITLES_SHOWN);
  });

  test('moves a channel the owner kept out of the list and names it, so it can be undone', () => {
    const list = buildSameTopicList(
      mapOf([entry('A'), entry('B', { kept: true, peer: true }), entry('D', { removed: true })]),
      read,
    );

    expect(list.channels.map((channel) => channel.id)).toEqual([cid('A')]);
    expect(list.kept).toEqual([{ id: cid('B'), title: 'Channel B' }]);
  });

  test('does not offer a kept channel for undoing when it was left out for another reason', () => {
    const list = buildSameTopicList(
      mapOf([entry('L', { outsideReason: 'larger', kept: true, peer: true })]),
      read,
    );

    expect(list.kept).toEqual([]);
  });

  test('leaves out channels written in another alphabet than the centre, and counts them', () => {
    const cyrillic = new Map([...stored, [cid('R'), videosOf('R', 'Как построили завод, часть')]]);

    const list = buildSameTopicList(
      mapOf([entry('A'), entry('R', { relevance: 0.13 })]),
      (channelId) => cyrillic.get(channelId) ?? [],
    );

    expect(list.channels.map((channel) => channel.id)).toEqual([cid('A')]);
    expect(list.otherAlphabet).toBe(1);
  });

  test('keeps other alphabets when the centre itself is not written in Latin letters', () => {
    const cyrillic = new Map([
      [cid('C'), videosOf('C', 'Как построили завод, часть')],
      [cid('R'), videosOf('R', 'Новое изобретение, серия')],
    ]);

    const list = buildSameTopicList(
      mapOf([entry('R')]),
      (channelId) => cyrillic.get(channelId) ?? [],
    );

    expect(list.channels.map((channel) => channel.id)).toEqual([cid('R')]);
    expect(list.otherAlphabet).toBe(0);
  });

  test('lists a channel whose videos are no longer in the store, with no titles', () => {
    const [channel] = buildSameTopicList(mapOf([entry('Z')]), read).channels;

    expect(channel?.recentTitles).toEqual([]);
  });

  test('is empty when nothing was left out on titles', () => {
    const list = buildSameTopicList(mapOf([entry('P', { peer: true, outsideReason: null })]), read);

    expect(list).toMatchObject({ channels: [], kept: [], otherAlphabet: 0 });
  });
});

describe('loadSameTopicList', () => {
  let deps: SnapshotDeps;

  /** The subject in the centre's words, and the same subject in other words. */
  const CENTRE_TITLES = [1, 2, 3, 4, 5].map((n) => `America just built machine number ${n}`);
  const OTHER_WORDS = [
    'Inside the factory nobody talks about',
    'Why this bridge will outlast us all',
    'The quiet engineers behind a giant dam',
    'Rails, steel and a very long tunnel',
    'What a shipyard looks like at night',
  ];

  beforeEach(() => {
    const db = openDatabase(':memory:');
    deps = {
      channels: new SqliteChannelRepo(db),
      videos: new SqliteVideoRepo(db),
      edges: new SqliteEdgeRepo(db),
      maps: new SqliteMapRepo(db),
    };
    const add = (letter: string, titles: readonly string[]) => {
      deps.channels.upsert(
        {
          id: cid(letter),
          title: `Channel ${letter}`,
          handle: `handle${letter}`,
          subscribers: 2000,
          subscribersHidden: false,
          videoCount: titles.length,
        },
        NOW,
      );
      deps.videos.upsertMany(
        titles.map((title, index) => storable(letter, index + 1, title)),
        NOW,
      );
    };
    add('C', CENTRE_TITLES);
    add('A', CENTRE_TITLES);
    add('B', OTHER_WORDS);
    deps.maps.create(
      {
        centerChannelId: cid('C'),
        depth: 1,
        region: 'US',
        members: [
          { channelId: cid('C'), steps: 0 },
          { channelId: cid('A'), steps: 1 },
          { channelId: cid('B'), steps: 1 },
        ],
      },
      NOW,
    );
  });

  test('is null when no map has been made around the channel', () => {
    expect(loadSameTopicList(deps, cid('A'), NOW)).toBeNull();
  });

  test('reads the latest map and the newest stored titles of each channel left out on titles', () => {
    const list = loadSameTopicList(deps, cid('C'), NOW);

    expect(list?.channels.map((channel) => channel.title)).toEqual(['Channel B']);
    expect(list?.channels[0]?.recentTitles.map((video) => video.title)).toEqual(
      OTHER_WORDS.slice(0, SAME_TOPIC_TITLES_SHOWN),
    );
    expect(list?.kept).toEqual([]);
  });

  test('drops a channel from the list once the owner keeps it, and brings it back on undo', () => {
    deps.maps.setKept(cid('C'), cid('B'), true, NOW);

    const kept = loadSameTopicList(deps, cid('C'), NOW);

    expect(kept?.channels).toEqual([]);
    expect(kept?.kept).toEqual([{ id: cid('B'), title: 'Channel B' }]);

    deps.maps.setKept(cid('C'), cid('B'), false, NOW);

    expect(loadSameTopicList(deps, cid('C'), NOW)?.channels).toHaveLength(1);
  });
});

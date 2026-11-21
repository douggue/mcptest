import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import { buildHookLibrary } from '../src/hooks/library';
import {
  mapChannelIds,
  pickedVideos,
  videosNamed,
  videosOnMap,
  type MapVideoDeps,
} from '../src/lab/mapVideos';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { StoredTranscript } from '../src/repos/types';

const NOW = new Date('2026-11-21T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (name: string) => `UC${name.padEnd(22, '_').slice(0, 22)}`;
const vid = (name: string) => name.padEnd(11, '_').slice(0, 11);

interface Store extends MapVideoDeps {
  readonly channels: SqliteChannelRepo;
  readonly videos: SqliteVideoRepo;
  readonly maps: SqliteMapRepo;
}

let store: Store;

function addChannel(name: string): void {
  store.channels.upsert(
    {
      id: cid(name),
      title: name,
      handle: null,
      subscribers: 1000,
      subscribersHidden: false,
      videoCount: null,
    },
    NOW,
  );
}

function addVideo(channel: string, name: string, views: number, daysAgo: number): void {
  store.videos.upsertMany(
    [
      {
        id: vid(name),
        channelId: cid(channel),
        title: `Title of ${name}`,
        views,
        durationSeconds: 600,
        published: {
          date: new Date(NOW.getTime() - daysAgo * DAY_MS),
          precision: 'day',
          raw: `${daysAgo}d ago`,
        },
      },
    ],
    NOW,
  );
}

function addMap(centre: string, others: readonly string[]): void {
  store.maps.create(
    {
      centerChannelId: cid(centre),
      depth: 1,
      region: 'US',
      members: [
        { channelId: cid(centre), steps: 0 },
        ...others.map((name) => ({ channelId: cid(name), steps: 1 })),
      ],
    },
    NOW,
  );
}

beforeEach(() => {
  const db = openDatabase(':memory:');
  store = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    maps: new SqliteMapRepo(db),
  };
  ['mine', 'alike', 'stranger', 'elsewhere'].forEach(addChannel);
  addMap('mine', ['alike']);
  addMap('elsewhere', ['stranger']);
  addVideo('mine', 'own', 500, 5);
  addVideo('alike', 'recent', 9000, 10);
  addVideo('alike', 'older', 4000, 60);
  addVideo('alike', 'ancient', 4000, 200);
  addVideo('stranger', 'theirs', 99_000, 3);
});

describe('the channels on a channel’s map', () => {
  test('are the centre and the channels its latest map holds', () => {
    expect(mapChannelIds(store.maps, cid('mine'))).toEqual(new Set([cid('mine'), cid('alike')]));
  });

  test('are unknown for a channel no map was made for', () => {
    expect(mapChannelIds(store.maps, cid('alike'))).toBeNull();
  });
});

describe('the videos picked as inspiration', () => {
  test('are stored videos of channels on that channel’s map, in the order picked', () => {
    const picked = pickedVideos(store, cid('mine'), [vid('older'), vid('own')]);

    expect(picked).toEqual({
      videos: [
        {
          videoId: vid('older'),
          title: 'Title of older',
          channelId: cid('alike'),
          channelTitle: 'alike',
        },
        {
          videoId: vid('own'),
          title: 'Title of own',
          channelId: cid('mine'),
          channelTitle: 'mine',
        },
      ],
    });
  });

  test.each([
    ['a video of a channel on another channel’s map', vid('theirs')],
    ['a video that is not stored', vid('nowhere')],
  ])('are refused for %s, with the video named', (_name, id) => {
    const picked = pickedVideos(store, cid('mine'), [vid('recent'), id]);

    expect(picked).toEqual({
      problem: `The video ${id} is not a stored video of a channel on this channel’s map.`,
    });
  });

  test('are refused for a channel with no map', () => {
    expect(pickedVideos(store, cid('alike'), [vid('recent')])).toEqual({
      problem: 'No map has been made for this channel yet.',
    });
  });
});

describe('the videos of a map inside a window', () => {
  test('are those of its channels published in the last so many days, with scores from the store', () => {
    const inside = videosOnMap(store, cid('mine'), NOW, 90);

    expect([...(inside?.keys() ?? [])].sort()).toEqual([vid('older'), vid('own'), vid('recent')]);
    expect(inside?.get(vid('recent'))).toMatchObject({
      videoId: vid('recent'),
      title: 'Title of recent',
      channelId: cid('alike'),
      channelTitle: 'alike',
      views: 9000,
    });
    expect(inside?.get(vid('recent'))?.ageDays).toBeCloseTo(10, 1);
  });

  test('leave out what is older than the window, and every other map’s videos', () => {
    const inside = videosOnMap(store, cid('mine'), NOW, 30);

    expect([...(inside?.keys() ?? [])].sort()).toEqual([vid('own'), vid('recent')]);
  });

  test('are unknown for a channel with no map', () => {
    expect(videosOnMap(store, cid('stranger'), NOW, 90)).toBeNull();
  });
});

describe('a hook library', () => {
  const source = (name: string, score: number) => ({
    videoId: vid(name),
    title: `Title of ${name}`,
    channelId: cid('alike'),
    channelTitle: 'alike',
    views: 9000,
    score,
  });
  const captions = (text: string | null): StoredTranscript => ({
    videoId: vid('recent'),
    transcript:
      text === null
        ? null
        : { language: 'en', autoGenerated: true, segments: [{ startMs: 0, text }] },
    fetchedAt: NOW,
  });

  test('gives each video its opening words from the stored captions, and its label when it has one', () => {
    const [hook] = buildHookLibrary(
      [source('recent', 8)],
      () => captions('the river was gone by morning'),
      [{ videoId: vid('recent'), style: 'cold open', how: 'It starts mid-scene.' }],
    );

    expect(hook).toEqual({
      ...source('recent', 8),
      captions: 'read',
      autoGenerated: true,
      language: 'en',
      text: 'the river was gone by morning',
      words: 6,
      lastLineAtSeconds: 0,
      style: 'cold open',
      how: 'It starts mid-scene.',
    });
  });

  test('lists a video without captions, and one whose captions were never read, as such', () => {
    const none = buildHookLibrary([source('recent', 8)], () => captions(null), []);
    const unread = buildHookLibrary([source('recent', 8)], () => null, []);

    expect(none[0]).toMatchObject({ captions: 'none', text: null, style: null });
    expect(unread[0]).toMatchObject({ captions: 'not-read', text: null, autoGenerated: null });
  });

  test('gives no words, and no label, for a video that says nothing in its first minute', () => {
    const [hook] = buildHookLibrary([source('recent', 8)], () => captions('[Music]'), [
      { videoId: vid('recent'), style: 'cold open', how: 'It starts mid-scene.' },
    ]);

    expect(hook).toMatchObject({ captions: 'read', text: null, words: null, style: null });
  });
});

describe('videosNamed', () => {
  beforeEach(() => {
    ['Mine', 'Near', 'Far', 'Studied'].forEach(addChannel);
    addVideo('Mine', 'mine1', 100, 5);
    addVideo('Near', 'near1', 900, 5);
    addVideo('Far', 'far1', 50_000, 5);
    addVideo('Studied', 'stud1', 700, 5);
    addMap('Mine', ['Near']);
  });

  test('gives the stored videos of this map that an answer names, in the order named', () => {
    const named = videosNamed(store, cid('Mine'), [vid('near1'), vid('mine1')]);

    expect(named).toEqual([
      {
        videoId: vid('near1'),
        title: 'Title of near1',
        channelId: cid('Near'),
        channelTitle: 'Near',
        views: 900,
      },
      {
        videoId: vid('mine1'),
        title: 'Title of mine1',
        channelId: cid('Mine'),
        channelTitle: 'Mine',
        views: 100,
      },
    ]);
  });

  test('drops an id that is not stored, and a stored video of a channel off this map', () => {
    const named = videosNamed(store, cid('Mine'), [vid('nowhere'), vid('far1'), vid('near1')]);

    expect(named.map((video) => video.videoId)).toEqual([vid('near1')]);
  });

  test('also takes the videos of one more stored channel, such as one that was broken down', () => {
    const ids = [vid('stud1'), vid('far1')];

    expect(videosNamed(store, cid('Mine'), ids).map((video) => video.videoId)).toEqual([]);
    expect(videosNamed(store, cid('Mine'), ids, cid('Studied')).map((v) => v.videoId)).toEqual([
      vid('stud1'),
    ]);
  });

  test('names each video once, and none for a channel with no map', () => {
    expect(videosNamed(store, cid('Mine'), [vid('near1'), vid('near1')])).toHaveLength(1);
    expect(videosNamed(store, cid('Far'), [vid('far1')])).toEqual([]);
  });
});

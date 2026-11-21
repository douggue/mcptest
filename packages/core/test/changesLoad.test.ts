import { beforeEach, describe, expect, test } from 'vitest';
import { loadChanges, resolveSince, type ChangesDeps } from '../src/changes/load';
import { openDatabase, type Db } from '../src/db/sqlite';
import { freezeMapSnapshot } from '../src/map/snapshot';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteEdgeRepo } from '../src/repos/sqliteEdgeRepo';
import { SqliteLookRepo } from '../src/repos/sqliteLookRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteRefreshRepo } from '../src/repos/sqliteRefreshRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { StorableVideo } from '../src/sources/types';

const NOW = new Date('2026-11-21T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (name: string) => name.padEnd(11, '_').slice(0, 11);
const CENTER = cid('c');
const OTHER_CENTER = cid('z');

let db: Db;
let deps: ChangesDeps;
let runs: SqliteRefreshRepo;

const addChannel = (letter: string, at: Date): void => {
  deps.channels.upsert(
    {
      id: cid(letter),
      title: `Channel ${letter}`,
      handle: null,
      subscribers: 1000,
      subscribersHidden: false,
      videoCount: null,
    },
    at,
  );
};

const video = (
  letter: string,
  name: string,
  views: number,
  publishedDays: number,
): StorableVideo => ({
  id: vid(name),
  channelId: cid(letter),
  title: `Title of ${name}`,
  views,
  durationSeconds: 600,
  published: { date: daysAgo(publishedDays), precision: 'day', raw: `${publishedDays}d ago` },
});

/** Five ordinary videos and one that may have grown, read at the given moment. */
const readChannel = (letter: string, at: Date, hitViews: number): void => {
  addChannel(letter, at);
  deps.videos.upsertMany(
    [
      ...[1, 2, 3, 4, 5].map((n) => video(letter, `${letter}old${n}`, 1000, 30 + n)),
      video(letter, `${letter}hit`, hitViews, 12),
    ],
    at,
  );
};

const makeMap = (members: readonly string[], at: Date): number => {
  const id = deps.maps.create(
    {
      centerChannelId: CENTER,
      depth: 1,
      region: 'US',
      members: [
        { channelId: CENTER, steps: 0 },
        ...members.map((letter) => ({ channelId: cid(letter), steps: 1 })),
      ],
    },
    at,
  );
  freezeMapSnapshot(deps, CENTER, at);
  return id;
};

beforeEach(() => {
  db = openDatabase(':memory:');
  runs = new SqliteRefreshRepo(db);
  deps = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    runs,
    looks: new SqliteLookRepo(db),
  };
  readChannel('c', daysAgo(6), 1000);
});

describe('SqliteLookRepo', () => {
  test('has no last look until the owner marks a channel as seen', () => {
    expect(deps.looks.lastLook(CENTER)).toBeNull();
  });

  test('keeps the last look per channel and moves it forward', () => {
    deps.looks.markSeen(CENTER, daysAgo(2));
    deps.looks.markSeen(OTHER_CENTER, daysAgo(4));
    deps.looks.markSeen(CENTER, daysAgo(1));

    expect(deps.looks.lastLook(CENTER)).toEqual(daysAgo(1));
    expect(deps.looks.lastLook(OTHER_CENTER)).toEqual(daysAgo(4));
  });

  test('finds the map that was the latest at an earlier moment', () => {
    const first = makeMap([], daysAgo(6));
    const second = makeMap([], daysAgo(2));

    expect(deps.looks.mapAsOf(CENTER, daysAgo(3))?.id).toBe(first);
    expect(deps.looks.mapAsOf(CENTER, NOW)?.id).toBe(second);
    expect(deps.looks.mapAsOf(CENTER, daysAgo(9))).toBeNull();
    expect(deps.looks.mapAsOf(OTHER_CENTER, NOW)).toBeNull();
  });
});

describe('resolveSince', () => {
  test('counts back a day or a week from now', () => {
    expect(resolveSince('yesterday', null, NOW)).toEqual({ since: daysAgo(1), kind: 'yesterday' });
    expect(resolveSince('week', daysAgo(2), NOW)).toEqual({ since: daysAgo(7), kind: 'week' });
  });

  test('uses the last look when there is one, and a week when the channel was never marked', () => {
    expect(resolveSince('last-look', daysAgo(2), NOW)).toEqual({
      since: daysAgo(2),
      kind: 'last-look',
    });
    expect(resolveSince('last-look', null, NOW)).toEqual({ since: daysAgo(7), kind: 'week' });
  });
});

describe('loadChanges', () => {
  test('is null for a channel with no map', () => {
    expect(loadChanges(deps, CENTER, daysAgo(3), NOW)).toBeNull();
  });

  test('compares the look-alikes of this map only, from their stored readings', () => {
    readChannel('a', daysAgo(6), 1100);
    readChannel('b', daysAgo(6), 1100);
    makeMap(['a'], daysAgo(6));
    deps.maps.setKept(CENTER, cid('a'), true, daysAgo(6));
    // Both grew, but only one is a look-alike on this map.
    readChannel('a', daysAgo(1), 9000);
    readChannel('b', daysAgo(1), 9000);

    const view = loadChanges(deps, CENTER, daysAgo(3), NOW);

    expect(view?.changes.newBreakouts.map((entry) => entry.videoId)).toEqual([vid('ahit')]);
    expect(view?.changes.comparedChannels).toBe(1);
    expect(view?.since).toBe(daysAgo(3).toISOString());
  });

  test('says when the look-alikes were last read and when the last refresh finished', () => {
    readChannel('a', daysAgo(6), 1100);
    readChannel('b', daysAgo(4), 1100);
    makeMap(['a', 'b'], daysAgo(4));
    deps.maps.setKept(CENTER, cid('a'), true, NOW);
    deps.maps.setKept(CENTER, cid('b'), true, NOW);
    runs.record({
      startedAt: daysAgo(4),
      finishedAt: daysAgo(4),
      refreshed: 2,
      failed: 0,
      stoppedEarly: false,
    });

    const view = loadChanges(deps, CENTER, daysAgo(3), NOW);

    expect(view?.freshness).toEqual({
      channels: 2,
      oldestReadAt: daysAgo(6).toISOString(),
      newestReadAt: daysAgo(4).toISOString(),
      lastRefreshAt: daysAgo(4).toISOString(),
    });
  });

  test('lists look-alikes new on the map and gone from it since an earlier map', () => {
    ['a', 'b', 'd'].forEach((letter) => readChannel(letter, daysAgo(6), 1100));
    makeMap(['a', 'b'], daysAgo(6));
    makeMap(['a', 'd'], daysAgo(1));
    ['a', 'b', 'd'].forEach((letter) => deps.maps.setKept(CENTER, cid(letter), true, NOW));

    const view = loadChanges(deps, CENTER, daysAgo(3), NOW);

    expect(view?.lookalikes).toEqual({
      comparable: true,
      earlierMapMadeAt: daysAgo(6).toISOString(),
      added: [{ channelId: cid('d'), title: 'Channel d' }],
      gone: [{ channelId: cid('b'), title: 'Channel b' }],
    });
  });

  test('says the map has not been remade when the latest map is older than the moment', () => {
    readChannel('a', daysAgo(6), 1100);
    makeMap(['a'], daysAgo(6));

    expect(loadChanges(deps, CENTER, daysAgo(3), NOW)?.lookalikes).toEqual({
      comparable: false,
      reason: 'same-map',
    });
  });

  test('says there is no earlier map when the first one was made after the moment', () => {
    readChannel('a', daysAgo(6), 1100);
    makeMap(['a'], daysAgo(1));

    expect(loadChanges(deps, CENTER, daysAgo(3), NOW)?.lookalikes).toEqual({
      comparable: false,
      reason: 'no-earlier-map',
    });
  });

  test('does not compare with an earlier map stored in a form it cannot read', () => {
    readChannel('a', daysAgo(6), 1100);
    const first = makeMap(['a'], daysAgo(6));
    deps.maps.saveSnapshot(first, JSON.stringify({ format: 2, snapshot: {} }));
    makeMap(['a'], daysAgo(1));

    expect(loadChanges(deps, CENTER, daysAgo(3), NOW)?.lookalikes).toEqual({
      comparable: false,
      reason: 'older-form',
    });
  });
});

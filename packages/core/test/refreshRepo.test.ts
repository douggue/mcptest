import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteRefreshRepo } from '../src/repos/sqliteRefreshRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { StorableVideo } from '../src/sources/types';

const T1 = new Date('2026-11-01T12:00:00Z');
const T2 = new Date('2026-11-10T12:00:00Z');
const T3 = new Date('2026-11-20T12:00:00Z');
const cid = (letter: string) => `UC${letter.repeat(22)}`;

const video = (letter: string, n: number, views: number): StorableVideo => ({
  id: letter.repeat(10) + String(n),
  channelId: cid(letter),
  title: `${letter} video ${n}`,
  views,
  durationSeconds: 600,
  published: { date: T1, precision: 'day', raw: '1d ago' },
});

let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
  const channels = new SqliteChannelRepo(db);
  for (const letter of ['A', 'B']) {
    channels.upsert(
      {
        id: cid(letter),
        title: `Channel ${letter}`,
        handle: null,
        subscribers: 100,
        subscribersHidden: false,
        videoCount: 2,
      },
      T1,
    );
  }
});

describe('SqliteRefreshRepo', () => {
  test('has no latest run before any refresh', () => {
    expect(new SqliteRefreshRepo(db).latest()).toBeNull();
  });

  test('records each run and gives back the one that finished last', () => {
    const runs = new SqliteRefreshRepo(db);
    runs.record({ startedAt: T1, finishedAt: T2, refreshed: 40, failed: 2, stoppedEarly: false });
    runs.record({ startedAt: T2, finishedAt: T3, refreshed: 3, failed: 5, stoppedEarly: true });

    expect(runs.latest()).toEqual({
      startedAt: T2,
      finishedAt: T3,
      refreshed: 3,
      failed: 5,
      stoppedEarly: true,
    });
  });
});

describe('SqliteVideoRepo.listChannelReadings', () => {
  test('lists every view reading of one channel since a date, oldest first', () => {
    const videos = new SqliteVideoRepo(db);
    videos.upsertMany([video('A', 1, 100), video('A', 2, 50), video('B', 1, 999)], T1);
    videos.upsertMany([video('A', 1, 300)], T2);
    videos.upsertMany([video('A', 1, 700), video('A', 2, 60)], T3);

    expect(videos.listChannelReadings(cid('A'), T2)).toEqual([
      { videoId: 'AAAAAAAAAA1', capturedAt: T2, views: 300, publishedAt: T1 },
      { videoId: 'AAAAAAAAAA1', capturedAt: T3, views: 700, publishedAt: T1 },
      { videoId: 'AAAAAAAAAA2', capturedAt: T3, views: 60, publishedAt: T1 },
    ]);
  });

  test('is empty for a channel with no videos', () => {
    expect(new SqliteVideoRepo(db).listChannelReadings(cid('B'), T1)).toEqual([]);
  });
});

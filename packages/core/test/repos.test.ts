import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import type { ChannelInfo, StorableVideo } from '../src/sources/types';

const T1 = new Date('2026-11-20T12:00:00Z');
const T2 = new Date('2026-11-21T12:00:00Z');

const channel: ChannelInfo = {
  id: 'UCHnyfMqiRRG1u-2MsSQLbXA',
  title: 'Veritasium',
  handle: 'veritasium',
  subscribers: 21_500_000,
  subscribersHidden: false,
  videoCount: 552,
};

const makeVideo = (id: string, views: number, daysAgo: number): StorableVideo => ({
  id,
  channelId: channel.id,
  title: `Video ${id}`,
  views,
  durationSeconds: 600,
  published: {
    date: new Date(T1.getTime() - daysAgo * 86_400_000),
    precision: 'day',
    raw: `${daysAgo}d ago`,
  },
});

let db: Db;
let channels: SqliteChannelRepo;
let videos: SqliteVideoRepo;

beforeEach(() => {
  db = openDatabase(':memory:');
  channels = new SqliteChannelRepo(db);
  videos = new SqliteVideoRepo(db);
});

describe('SqliteChannelRepo', () => {
  test('counts the reads of a channel that failed in a row, and when the last one was', () => {
    channels.upsert(channel, T1);

    channels.recordReadFailure(channel.id, T1);
    channels.recordReadFailure(channel.id, T2);

    expect(channels.listReadFailures()).toEqual([
      { channelId: channel.id, failures: 2, lastFailedAt: T2 },
    ]);
  });

  test('forgets the failed reads of a channel once it is read again', () => {
    channels.upsert(channel, T1);
    channels.recordReadFailure(channel.id, T1);

    channels.upsert(channel, T2);

    expect(channels.listReadFailures()).toEqual([]);
  });

  test('records nothing for a channel that is not in the store', () => {
    channels.recordReadFailure(channel.id, T1);

    expect(channels.listReadFailures()).toEqual([]);
  });

  test('returns null for a channel that was never stored', () => {
    expect(channels.findById('UCxxxxxxxxxxxxxxxxxxxxxx')).toBeNull();
    expect(channels.findByHandle('nobody')).toBeNull();
  });

  test('stores a channel and finds it by id or handle, ignoring handle case', () => {
    channels.upsert(channel, T1);

    expect(channels.findById(channel.id)).toEqual({ ...channel, fetchedAt: T1 });
    expect(channels.findByHandle('Veritasium')?.id).toBe(channel.id);
  });

  test('replaces the stored row on a second upsert', () => {
    channels.upsert(channel, T1);
    channels.upsert({ ...channel, subscribers: 22_000_000 }, T2);

    const stored = channels.findById(channel.id);
    expect(stored?.subscribers).toBe(22_000_000);
    expect(stored?.fetchedAt).toEqual(T2);
  });

  test('keeps hidden subscriber counts as null', () => {
    channels.upsert({ ...channel, subscribers: null, subscribersHidden: true }, T1);

    expect(channels.findById(channel.id)).toMatchObject({
      subscribers: null,
      subscribersHidden: true,
    });
  });

  test('lists every stored channel in a steady order', () => {
    const other = { ...channel, id: 'UCAAAAAAAAAAAAAAAAAAAAAA', title: 'Other', handle: null };

    expect(channels.listAll()).toEqual([]);

    channels.upsert(channel, T1);
    channels.upsert(other, T2);

    expect(channels.listAll()).toEqual([
      { ...other, fetchedAt: T2 },
      { ...channel, fetchedAt: T1 },
    ]);
  });
});

describe('SqliteVideoRepo', () => {
  beforeEach(() => {
    channels.upsert(channel, T1);
  });

  test('lists a channel’s videos newest first', () => {
    videos.upsertMany([makeVideo('old', 10, 30), makeVideo('new', 20, 1)], T1);

    expect(videos.listByChannel(channel.id).map((v) => v.id)).toEqual(['new', 'old']);
  });

  test('finds one video by its id, and nothing for an id it has not stored', () => {
    videos.upsertMany([makeVideo('abc', 1234, 3)], T1);

    expect(videos.findById('abc')).toEqual({ ...makeVideo('abc', 1234, 3), fetchedAt: T1 });
    expect(videos.findById('missing')).toBeNull();
  });

  test('round-trips every field of a video', () => {
    const video = makeVideo('abc', 1234, 3);
    videos.upsertMany([video], T1);

    expect(videos.listByChannel(channel.id)[0]).toEqual({ ...video, fetchedAt: T1 });
  });

  test('updates views on a later fetch and keeps one snapshot per fetch', () => {
    videos.upsertMany([makeVideo('abc', 100, 3)], T1);
    videos.upsertMany([makeVideo('abc', 250, 3)], T2);

    expect(videos.listByChannel(channel.id)[0]?.views).toBe(250);
    expect(videos.listSnapshots('abc')).toEqual([
      { capturedAt: T1, views: 100 },
      { capturedAt: T2, views: 250 },
    ]);
  });

  test('treats titles containing quotes as data', () => {
    const tricky = { ...makeVideo('q', 1, 1), title: `Robert'); DROP TABLE videos;--` };
    videos.upsertMany([tricky], T1);

    expect(videos.listByChannel(channel.id)[0]?.title).toBe(tricky.title);
  });
});

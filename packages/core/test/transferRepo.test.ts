import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteFactsRepo } from '../src/repos/sqliteFactsRepo';
import { SqliteTransferRepo } from '../src/repos/sqliteTransferRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';

const NOW = new Date('2026-11-20T12:00:00Z');
const LATER = new Date('2026-11-25T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);

function seed(db: Db): void {
  const channels = new SqliteChannelRepo(db);
  const videos = new SqliteVideoRepo(db);
  channels.upsert(
    {
      id: cid('A'),
      title: 'Channel A',
      handle: null,
      subscribers: 7440,
      subscribersHidden: false,
      videoCount: null,
    },
    NOW,
  );
  channels.upsert(
    {
      id: cid('B'),
      title: 'Channel B',
      handle: null,
      subscribers: null,
      subscribersHidden: true,
      videoCount: null,
    },
    NOW,
  );
  new SqliteFactsRepo(db).record(
    [cid('A')],
    [{ id: cid('A'), createdAt: NOW, country: 'ZA', totalViews: null }],
    NOW,
  );
  const video = (id: string, channel: string, title: string, days: number, views: number) => ({
    id,
    channelId: cid(channel),
    title,
    views,
    durationSeconds: id === 'bbbbbbbbbb1' ? null : 840,
    published: { date: daysAgo(days), precision: 'day' as const, raw: `${days}d ago` },
  });
  videos.upsertMany(
    [
      video('aaaaaaaaaa1', 'A', 'Recent from A', 5, 521_000),
      video('aaaaaaaaaa2', 'A', 'Old from A', 200, 9000),
      video('bbbbbbbbbb1', 'B', 'Recent from B', 89, 40),
    ],
    NOW,
  );
}

describe('SqliteTransferRepo', () => {
  let transfers: SqliteTransferRepo;

  beforeEach(() => {
    const db = openDatabase(':memory:');
    seed(db);
    transfers = new SqliteTransferRepo(db);
  });

  test('lists the videos published since a date, each with what is needed of its channel', () => {
    expect(transfers.listRecentVideos(daysAgo(90))).toEqual([
      {
        id: 'aaaaaaaaaa1',
        channelId: cid('A'),
        title: 'Recent from A',
        views: 521_000,
        durationSeconds: 840,
        publishedAt: daysAgo(5),
        channelTitle: 'Channel A',
        subscribers: 7440,
        country: 'ZA',
      },
      {
        id: 'bbbbbbbbbb1',
        channelId: cid('B'),
        title: 'Recent from B',
        views: 40,
        durationSeconds: null,
        publishedAt: daysAgo(89),
        channelTitle: 'Channel B',
        subscribers: null,
        country: null,
      },
    ]);
  });

  test('leaves out everything older, so an old store costs nothing to go through', () => {
    expect(transfers.listRecentVideos(daysAgo(4))).toEqual([]);
    expect(transfers.listRecentVideos(daysAgo(300))).toHaveLength(3);
  });

  test('starts with nothing saved', () => {
    expect(transfers.listSaved()).toEqual([]);
  });

  test('remembers a saved idea by its key, with the title it had when saved, once', () => {
    transfers.setSaved('{place} just found fuel', '{place} just found a fuel', true, NOW);
    transfers.setSaved('{place} just found fuel', 'another wording', true, LATER);
    transfers.setSaved('a b c', 'a b c', true, LATER);

    expect(transfers.listSaved()).toEqual([
      { key: 'a b c', template: 'a b c', savedAt: LATER },
      { key: '{place} just found fuel', template: '{place} just found a fuel', savedAt: NOW },
    ]);
  });

  test('forgets an idea the owner stops saving', () => {
    transfers.setSaved('a b c', 'a b c', true, NOW);

    transfers.setSaved('a b c', 'a b c', false, LATER);
    transfers.setSaved('never saved', 'never saved', false, LATER);

    expect(transfers.listSaved()).toEqual([]);
  });
});

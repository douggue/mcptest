import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteWatchlistRepo } from '../src/repos/sqliteWatchlistRepo';

const T1 = new Date('2026-11-20T12:00:00Z');
const T2 = new Date('2026-11-25T12:00:00Z');
const cid = (letter: string) => `UC${letter.repeat(22)}`;

function seed(db: Db): void {
  const channels = new SqliteChannelRepo(db);
  for (const letter of ['A', 'B']) {
    channels.upsert(
      {
        id: cid(letter),
        title: `Channel ${letter}`,
        handle: null,
        subscribers: 100,
        subscribersHidden: false,
        videoCount: null,
      },
      T1,
    );
  }
}

describe('SqliteWatchlistRepo', () => {
  let watchlist: SqliteWatchlistRepo;

  beforeEach(() => {
    const db = openDatabase(':memory:');
    seed(db);
    watchlist = new SqliteWatchlistRepo(db);
  });

  test('starts with nothing watched', () => {
    expect(watchlist.listWatched()).toEqual([]);
  });

  test('remembers watched channels, once each', () => {
    watchlist.setWatched(cid('B'), true, T1);
    watchlist.setWatched(cid('A'), true, T1);
    watchlist.setWatched(cid('A'), true, T2);

    expect(watchlist.listWatched()).toEqual([cid('A'), cid('B')]);
  });

  test('forgets a channel the owner stops watching', () => {
    watchlist.setWatched(cid('A'), true, T1);
    watchlist.setWatched(cid('B'), true, T1);

    watchlist.setWatched(cid('A'), false, T2);
    watchlist.setWatched(cid('A'), false, T2);

    expect(watchlist.listWatched()).toEqual([cid('B')]);
  });

  test('refuses a channel that is not in the store', () => {
    expect(() => watchlist.setWatched(cid('Z'), true, T1)).toThrow();
  });

  test('keeps the list when the store is closed and opened again', () => {
    const path = `${tmpdir()}/jgtube-watchlist-${process.pid}-${Date.now()}.db`;
    const first = openDatabase(path);
    seed(first);
    new SqliteWatchlistRepo(first).setWatched(cid('A'), true, T1);
    first.close();

    const reopened = openDatabase(path);

    expect(new SqliteWatchlistRepo(reopened).listWatched()).toEqual([cid('A')]);
    reopened.close();
    rmSync(path, { force: true });
  });
});

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, test } from 'vitest';
import { migrate, openDatabase, type Db } from '../src/db/sqlite';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteEdgeRepo } from '../src/repos/sqliteEdgeRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import type { RecEdge } from '../src/repos/types';

const T1 = new Date('2026-11-20T12:00:00Z');
const T2 = new Date('2026-11-25T12:00:00Z');
const cid = (letter: string) => `UC${letter.repeat(22)}`;

const edge = (to: string, hits: number): RecEdge => ({
  fromChannelId: cid('C'),
  toChannelId: cid(to),
  hits,
  sampled: 10,
  share: hits / 10,
});

let db: Db;
let edges: SqliteEdgeRepo;
let maps: SqliteMapRepo;

beforeEach(() => {
  db = openDatabase(':memory:');
  edges = new SqliteEdgeRepo(db);
  maps = new SqliteMapRepo(db);
  const channels = new SqliteChannelRepo(db);
  for (const letter of ['C', 'A', 'B']) {
    channels.upsert(
      {
        id: cid(letter),
        title: `Channel ${letter}`,
        handle: null,
        subscribers: null,
        subscribersHidden: true,
        videoCount: null,
      },
      T1,
    );
  }
});

describe('SqliteEdgeRepo', () => {
  test('returns null for a channel whose recommendations were never read', () => {
    expect(edges.listFrom(cid('C'))).toBeNull();
  });

  test('stores edges strongest first with the time they were read', () => {
    edges.replaceFrom(cid('C'), [edge('A', 3), edge('B', 7)], 'US', T1);

    expect(edges.listFrom(cid('C'))).toEqual({
      crawledAt: T1,
      region: 'US',
      edges: [edge('B', 7), edge('A', 3)],
    });
  });

  test('remembers a read that found no recommendations', () => {
    edges.replaceFrom(cid('C'), [], 'US', T1);

    expect(edges.listFrom(cid('C'))).toEqual({ crawledAt: T1, region: 'US', edges: [] });
  });

  test('replaces earlier edges on a later read', () => {
    edges.replaceFrom(cid('C'), [edge('A', 3), edge('B', 7)], 'US', T1);
    edges.replaceFrom(cid('C'), [edge('A', 9)], 'US', T2);

    expect(edges.listFrom(cid('C'))).toEqual({
      crawledAt: T2,
      region: 'US',
      edges: [edge('A', 9)],
    });
  });

  test('lists every edge between a set of channels', () => {
    edges.replaceFrom(cid('C'), [edge('A', 3), edge('B', 7)], 'US', T1);

    expect(edges.listAmong([cid('C'), cid('A')])).toEqual([edge('A', 3)]);
    expect(edges.listAmong([])).toEqual([]);
  });
});

describe('SqliteMapRepo', () => {
  const members = [
    { channelId: cid('C'), steps: 0 },
    { channelId: cid('A'), steps: 1 },
  ];

  test('returns null when a channel has no saved map', () => {
    expect(maps.latestForCenter(cid('C'))).toBeNull();
  });

  test('saves a map and loads it back with its members in order of distance', () => {
    const id = maps.create({ centerChannelId: cid('C'), depth: 2, region: 'US', members }, T1);

    expect(maps.latestForCenter(cid('C'))).toEqual({
      id,
      centerChannelId: cid('C'),
      depth: 2,
      region: 'US',
      createdAt: T1,
      members,
    });
  });

  test('returns the most recent map for a channel', () => {
    maps.create({ centerChannelId: cid('C'), depth: 1, region: 'US', members }, T1);
    const newer = maps.create({ centerChannelId: cid('C'), depth: 2, region: 'US', members }, T2);

    expect(maps.latestForCenter(cid('C'))?.id).toBe(newer);
  });

  test('starts with no stored snapshot and no removals', () => {
    const id = maps.create({ centerChannelId: cid('C'), depth: 2, region: 'US', members }, T1);

    expect(maps.findSnapshot(id)).toBeNull();
    expect(maps.findSnapshot(9999)).toBeNull();
    expect(maps.listRemoved(cid('C'))).toEqual([]);
  });

  test('remembers removals per centre channel and forgets them on restore', () => {
    maps.setRemoved(cid('C'), cid('B'), true, T1);
    maps.setRemoved(cid('C'), cid('A'), true, T1);
    maps.setRemoved(cid('C'), cid('A'), true, T2);

    expect(maps.listRemoved(cid('C'))).toEqual([cid('A'), cid('B')]);
    expect(maps.listRemoved(cid('A'))).toEqual([]);

    maps.setRemoved(cid('C'), cid('A'), false, T2);
    expect(maps.listRemoved(cid('C'))).toEqual([cid('B')]);
  });
});

describe('opening a store made by an earlier version', () => {
  test.each([
    ['before versions were recorded', 0],
    ['at version 1', 1],
  ])('adds what is missing and keeps what is there (store %s)', (_what, version) => {
    const path = `${tmpdir()}/jgtube-migrate-${process.pid}-${Date.now()}-${version}.db`;
    const first = openDatabase(path);
    new SqliteChannelRepo(first).upsert(
      {
        id: cid('C'),
        title: 'Kept',
        handle: null,
        subscribers: 1,
        subscribersHidden: false,
        videoCount: null,
      },
      T1,
    );
    first.pragma(`user_version = ${version}`);
    first.exec('ALTER TABLE maps DROP COLUMN snapshot_json; DROP TABLE map_removals;');
    first.close();

    const reopened = openDatabase(path);

    expect(reopened.pragma('user_version', { simple: true })).toBe(2);
    expect(new SqliteChannelRepo(reopened).findById(cid('C'))?.title).toBe('Kept');
    expect(new SqliteMapRepo(reopened).listRemoved(cid('C'))).toEqual([]);
    reopened.close();
    rmSync(path, { force: true });
  });

  test('refuses a store made by a newer version instead of guessing at it', () => {
    db.pragma('user_version = 99');

    expect(() => migrate(db)).toThrow(/newer version/);
  });

  test('leaves the store as it was when a step fails halfway', () => {
    const steps = ['', '', 'CREATE TABLE half_made (a TEXT); THIS IS NOT SQL;'];

    expect(() => migrate(db, steps)).toThrow();

    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_made'").get(),
    ).toBeUndefined();
  });

  test('does nothing when the store is already up to date', () => {
    migrate(db);

    expect(db.pragma('user_version', { simple: true })).toBe(2);
  });
});

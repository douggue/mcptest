import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { migrate, openDatabase, type Db } from '../src/db/sqlite';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteEdgeRepo } from '../src/repos/sqliteEdgeRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import type { RecEdge } from '../src/repos/types';

/** The number of the newest schema step. */
const LATEST = 12;
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
      modelChannelId: null,
    });
  });

  test('remembers the model channel a map was measured against', () => {
    maps.create(
      { centerChannelId: cid('C'), modelChannelId: cid('A'), depth: 2, region: 'US', members },
      T1,
    );

    expect(maps.latestForCenter(cid('C'))?.modelChannelId).toBe(cid('A'));
  });

  test('returns the most recent map for a channel', () => {
    maps.create({ centerChannelId: cid('C'), depth: 1, region: 'US', members }, T1);
    const newer = maps.create({ centerChannelId: cid('C'), depth: 2, region: 'US', members }, T2);

    expect(maps.latestForCenter(cid('C'))?.id).toBe(newer);
  });

  test('lists each channel a map was made around, once', () => {
    expect(maps.listCenterIds()).toEqual([]);

    maps.create({ centerChannelId: cid('C'), depth: 1, region: 'US', members }, T1);
    maps.create({ centerChannelId: cid('C'), depth: 2, region: 'US', members }, T2);
    maps.create({ centerChannelId: cid('A'), depth: 1, region: 'US', members: [] }, T2);

    expect(maps.listCenterIds()).toEqual([cid('A'), cid('C')]);
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

describe('channels the owner keeps as competitors', () => {
  test('starts with none kept', () => {
    expect(maps.listKept(cid('C'))).toEqual([]);
  });

  test('remembers kept channels per centre channel and forgets them on undo', () => {
    maps.setKept(cid('C'), cid('B'), true, T1);
    maps.setKept(cid('C'), cid('A'), true, T1);
    maps.setKept(cid('C'), cid('A'), true, T2);

    expect(maps.listKept(cid('C'))).toEqual([cid('A'), cid('B')]);
    expect(maps.listKept(cid('A'))).toEqual([]);

    maps.setKept(cid('C'), cid('A'), false, T2);
    expect(maps.listKept(cid('C'))).toEqual([cid('B')]);
  });

  test('keeping a removed channel restores it', () => {
    maps.setRemoved(cid('C'), cid('A'), true, T1);

    maps.setKept(cid('C'), cid('A'), true, T2);

    expect(maps.listKept(cid('C'))).toEqual([cid('A')]);
    expect(maps.listRemoved(cid('C'))).toEqual([]);
  });

  test('removing a kept channel stops keeping it', () => {
    maps.setKept(cid('C'), cid('A'), true, T1);

    maps.setRemoved(cid('C'), cid('A'), true, T2);

    expect(maps.listRemoved(cid('C'))).toEqual([cid('A')]);
    expect(maps.listKept(cid('C'))).toEqual([]);
  });

  test('undoing one choice leaves the other alone', () => {
    maps.setKept(cid('C'), cid('A'), true, T1);
    maps.setRemoved(cid('C'), cid('B'), true, T1);

    maps.setRemoved(cid('C'), cid('A'), false, T2);
    maps.setKept(cid('C'), cid('B'), false, T2);

    expect(maps.listKept(cid('C'))).toEqual([cid('A')]);
    expect(maps.listRemoved(cid('C'))).toEqual([cid('B')]);
  });
});

describe('opening a store made by an earlier version', () => {
  test.each([
    ['before versions were recorded', 0],
    ['at version 1', 1],
  ])('adds what is missing and keeps what is there (store %s)', (_what, version) => {
    const folder = mkdtempSync(join(tmpdir(), 'jgtube-migrate-'));
    const path = join(folder, 'store.db');
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
    // Undo what later steps add with ALTER, so the store looks as that version left it.
    first.exec(
      `ALTER TABLE maps DROP COLUMN snapshot_json; ALTER TABLE maps DROP COLUMN model_channel;
       DROP TABLE map_removals;
       ALTER TABLE channels DROP COLUMN created_at; ALTER TABLE channels DROP COLUMN country;
       ALTER TABLE channels DROP COLUMN total_views;
       ALTER TABLE channels DROP COLUMN facts_fetched_at;
       ALTER TABLE channels DROP COLUMN read_failures;
       ALTER TABLE channels DROP COLUMN read_failed_at;
       ALTER TABLE channels DROP COLUMN description; ALTER TABLE channels DROP COLUMN avatar_json;
       ALTER TABLE channels DROP COLUMN banner_json;
       ALTER TABLE channels DROP COLUMN keywords_json;
       ALTER TABLE channels DROP COLUMN links_json;
       ALTER TABLE channels DROP COLUMN brand_fetched_at;`,
    );
    first.close();

    const reopened = openDatabase(path);

    expect(reopened.pragma('user_version', { simple: true })).toBe(LATEST);
    expect(new SqliteChannelRepo(reopened).findById(cid('C'))?.title).toBe('Kept');
    expect(new SqliteMapRepo(reopened).listRemoved(cid('C'))).toEqual([]);
    expect(new SqliteMapRepo(reopened).listKept(cid('C'))).toEqual([]);
    reopened.close();
    // The store held a channel, so it was copied as it was before being updated.
    expect(readdirSync(folder).filter((name) => name.includes('.backup-'))).toEqual([
      expect.stringMatching(new RegExp(`^store\\.backup-v${version}-\\d{8}-\\d{6}\\.db$`)),
    ]);
    rmSync(folder, { recursive: true, force: true });
  });

  test('refuses a store made by a newer version instead of guessing at it', () => {
    db.pragma('user_version = 99');

    expect(() => migrate(db)).toThrow(/newer version/);
  });

  test('leaves the store as it was when a step fails halfway', () => {
    const steps = [
      ...new Array<string>(LATEST).fill(''),
      'CREATE TABLE half_made (a TEXT); THIS IS NOT SQL;',
    ];

    expect(() => migrate(db, steps)).toThrow();

    expect(db.pragma('user_version', { simple: true })).toBe(LATEST);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_made'").get(),
    ).toBeUndefined();
  });

  test('does nothing when the store is already up to date', () => {
    migrate(db);

    expect(db.pragma('user_version', { simple: true })).toBe(LATEST);
  });
});

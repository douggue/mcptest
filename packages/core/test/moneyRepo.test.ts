import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteMoneyRepo } from '../src/repos/sqliteMoneyRepo';

const T1 = new Date('2026-11-20T12:00:00Z');
const T2 = new Date('2026-11-21T12:00:00Z');
const cid = (letter: string) => `UC${letter.repeat(22)}`;

describe('SqliteMoneyRepo', () => {
  let db: Db;
  let money: SqliteMoneyRepo;

  beforeEach(() => {
    db = openDatabase(':memory:');
    money = new SqliteMoneyRepo(db);
  });

  test('a channel never checked has no signs', () => {
    expect(money.find(cid('A'))).toBeNull();
    expect(money.findMany([])).toEqual(new Map());
  });

  test('keeps what a check found, and a new check replaces it', () => {
    money.save({
      channelId: cid('A'),
      videoId: 'abcdefghijk',
      memberships: true,
      ads: 'unknown',
      checkedAt: T1,
    });
    money.save({
      channelId: cid('A'),
      videoId: 'bcdefghijkl',
      memberships: false,
      ads: 'none',
      checkedAt: T2,
    });
    expect(money.find(cid('A'))).toEqual({
      channelId: cid('A'),
      videoId: 'bcdefghijkl',
      memberships: false,
      ads: 'none',
      checkedAt: T2,
    });
  });

  test('reads many channels at once, leaving out those never checked', () => {
    money.save({
      channelId: cid('A'),
      videoId: 'abcdefghijk',
      memberships: true,
      ads: 'shown',
      checkedAt: T1,
    });
    money.save({
      channelId: cid('B'),
      videoId: 'abcdefghijk',
      memberships: false,
      ads: 'unknown',
      checkedAt: T1,
    });
    const found = money.findMany([cid('A'), cid('B'), cid('C')]);
    expect([...found.keys()].sort()).toEqual([cid('A'), cid('B')]);
    expect(found.get(cid('A'))?.ads).toBe('shown');
  });

  test('a stored value outside the rules reads as unknown ads', () => {
    db.pragma('ignore_check_constraints = ON');
    db.prepare(`INSERT INTO channel_money_signs VALUES (?, 'abcdefghijk', 1, 'odd', ?)`).run(
      cid('A'),
      T1.toISOString(),
    );
    expect(money.find(cid('A'))?.ads).toBe('unknown');
  });

  test('refuses a bad channel or video id', () => {
    const base = { memberships: false, ads: 'none', checkedAt: T1 } as const;
    expect(() => money.save({ ...base, channelId: 'nope', videoId: 'abcdefghijk' })).toThrow();
    expect(() => money.save({ ...base, channelId: cid('A'), videoId: 'bad' })).toThrow();
  });
});

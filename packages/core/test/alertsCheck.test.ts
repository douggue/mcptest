import { beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_ALERT_MIN_SCORE } from '../src/alerts/alerts';
import { checkDueAlerts, type AlertCheckDeps } from '../src/alerts/check';
import { openDatabase, type Db } from '../src/db/sqlite';
import { freezeMapSnapshot } from '../src/map/snapshot';
import { SqliteAlertRepo } from '../src/repos/sqliteAlertRepo';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteEdgeRepo } from '../src/repos/sqliteEdgeRepo';
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
const OTHER = cid('z');

let db: Db;
let deps: AlertCheckDeps;
let alerts: SqliteAlertRepo;
let runs: SqliteRefreshRepo;

const video = (letter: string, name: string, views: number, days: number): StorableVideo => ({
  id: vid(name),
  channelId: cid(letter),
  title: `Title of ${name}`,
  views,
  durationSeconds: 600,
  published: { date: daysAgo(days), precision: 'day', raw: `${days}d ago` },
});

/** Five ordinary videos and one that may have grown, read at the given moment. */
const readChannel = (letter: string, at: Date, hitViews: number): void => {
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
  deps.videos.upsertMany(
    [
      ...[1, 2, 3, 4, 5].map((n) => video(letter, `${letter}old${n}`, 1000, 30 + n)),
      video(letter, `${letter}hit`, hitViews, 12),
    ],
    at,
  );
};

const makeMap = (center: string, members: readonly string[], at: Date): void => {
  deps.maps.create(
    {
      centerChannelId: center,
      depth: 1,
      region: 'US',
      members: [
        { channelId: center, steps: 0 },
        ...members.map((letter) => ({ channelId: cid(letter), steps: 1 })),
      ],
    },
    at,
  );
  freezeMapSnapshot(deps, center, at);
};

const refreshed = (at: Date): void =>
  runs.record({ startedAt: at, finishedAt: at, refreshed: 1, failed: 0, stoppedEarly: false });

const criteria = { minScore: DEFAULT_ALERT_MIN_SCORE, takenOff: true, enabled: true };

beforeEach(() => {
  db = openDatabase(':memory:');
  runs = new SqliteRefreshRepo(db);
  alerts = new SqliteAlertRepo(db);
  deps = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    runs,
    alerts,
  };
  readChannel('c', daysAgo(6), 1000);
  readChannel('a', daysAgo(5), 1000);
  makeMap(CENTER, ['a'], daysAgo(5));
});

describe('SqliteAlertRepo', () => {
  test('has no rule until one is saved, then keeps it per channel', () => {
    expect(alerts.rule(CENTER)).toBeNull();

    const saved = alerts.saveRule(CENTER, criteria, daysAgo(4));
    alerts.saveRule(OTHER, { ...criteria, minScore: 3 }, daysAgo(4));

    expect(saved).toEqual({
      centerChannelId: CENTER,
      ...criteria,
      createdAt: daysAgo(4),
      checkedAt: daysAgo(4),
    });
    expect(alerts.listRules().map((rule) => [rule.centerChannelId, rule.minScore])).toEqual([
      [CENTER, 5],
      [OTHER, 3],
    ]);
  });

  test('changing a rule keeps when it was made and last checked', () => {
    alerts.saveRule(CENTER, criteria, daysAgo(4));

    const changed = alerts.saveRule(
      CENTER,
      { ...criteria, minScore: 8, takenOff: false },
      daysAgo(1),
    );

    expect(changed).toMatchObject({
      minScore: 8,
      takenOff: false,
      createdAt: daysAgo(4),
      checkedAt: daysAgo(4),
    });
  });

  test('keeps each alert once, counts the unread ones and marks them read', () => {
    const finding = {
      kind: 'breakout' as const,
      subjectId: vid('ahit'),
      channelId: cid('a'),
      channelTitle: 'Channel a',
      videoTitle: 'Title of ahit',
      score: 9,
      views: 9000,
    };

    expect(alerts.add(CENTER, [finding, finding], daysAgo(1))).toBe(1);
    expect(alerts.add(CENTER, [finding], NOW)).toBe(0);
    expect(alerts.add(OTHER, [finding], NOW)).toBe(1);
    expect(Object.fromEntries(alerts.unreadCounts())).toEqual({ [CENTER]: 1, [OTHER]: 1 });

    expect(alerts.markRead(CENTER, NOW)).toBe(1);

    expect(Object.fromEntries(alerts.unreadCounts())).toEqual({ [OTHER]: 1 });
    expect(alerts.list(CENTER, 10)).toEqual([
      { id: 1, centerChannelId: CENTER, ...finding, foundAt: daysAgo(1), readAt: NOW },
    ]);
  });
});

describe('checkDueAlerts', () => {
  test('tells of a look-alike video past the number after a refresh, and only once', () => {
    alerts.saveRule(CENTER, criteria, daysAgo(4));
    readChannel('a', daysAgo(1), 50_000);
    refreshed(daysAgo(1));

    expect(checkDueAlerts(deps, NOW)).toEqual({ checked: 1, added: 1 });
    expect(alerts.list(CENTER, 10).map((alert) => [alert.kind, alert.subjectId])).toEqual([
      ['breakout', vid('ahit')],
    ]);
    expect(alerts.rule(CENTER)?.checkedAt).toEqual(NOW);

    refreshed(new Date(NOW.getTime() + 1000));
    expect(checkDueAlerts(deps, new Date(NOW.getTime() + 2000))).toEqual({ checked: 1, added: 0 });
  });

  test('checks nothing when no refresh has finished since the last check', () => {
    alerts.saveRule(CENTER, criteria, daysAgo(4));
    refreshed(daysAgo(4.5));

    expect(checkDueAlerts(deps, NOW)).toEqual({ checked: 0, added: 0 });
    expect(alerts.rule(CENTER)?.checkedAt).toEqual(daysAgo(4));
  });

  test('passes over a rule that is switched off', () => {
    alerts.saveRule(CENTER, { ...criteria, enabled: false }, daysAgo(4));
    readChannel('a', daysAgo(1), 50_000);
    refreshed(daysAgo(1));

    expect(checkDueAlerts(deps, NOW)).toEqual({ checked: 0, added: 0 });
  });

  test('marks a rule checked when its channel no longer has a map', () => {
    alerts.saveRule(OTHER, criteria, daysAgo(4));
    refreshed(daysAgo(1));

    expect(checkDueAlerts(deps, NOW)).toEqual({ checked: 1, added: 0 });
    expect(alerts.rule(OTHER)?.checkedAt).toEqual(NOW);
  });
});

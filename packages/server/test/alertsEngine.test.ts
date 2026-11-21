import {
  DEFAULT_ALERT_MIN_SCORE,
  SqliteAlertRepo,
  SqliteChannelRepo,
  SqliteEdgeRepo,
  SqliteMapRepo,
  SqliteRefreshRepo,
  SqliteVideoRepo,
  openDatabase,
} from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';

type StorableVideo = Parameters<SqliteVideoRepo['upsertMany']>[0][number];
import { alertsEngine, ALERTS_SHOWN } from '../src/alertsEngine';
import type { AlertsEngine } from '../src/alertsTypes';

const DAY_MS = 86_400_000;
const START = new Date('2026-11-21T12:00:00Z');
const at = (days: number) => new Date(START.getTime() + days * DAY_MS);
const CENTER = `UC${'c'.repeat(22)}`;
const PEER = `UC${'a'.repeat(22)}`;
const NO_MAP = `UC${'n'.repeat(22)}`;

let clock: Date;
let engine: AlertsEngine;
let repos: {
  channels: SqliteChannelRepo;
  videos: SqliteVideoRepo;
  edges: SqliteEdgeRepo;
  maps: SqliteMapRepo;
  runs: SqliteRefreshRepo;
  alerts: SqliteAlertRepo;
};

const video = (id: string, channelId: string, views: number, days: number): StorableVideo => ({
  id: id.padEnd(11, '_'),
  channelId,
  title: `Title ${id}`,
  views,
  durationSeconds: 600,
  published: { date: at(-days), precision: 'day', raw: `${days}d ago` },
});

const read = (channelId: string, when: Date, hit: number): void => {
  repos.channels.upsert(
    {
      id: channelId,
      title: channelId === CENTER ? 'Mine' : 'Peer',
      handle: null,
      subscribers: 1000,
      subscribersHidden: false,
      videoCount: null,
    },
    when,
  );
  const tag = channelId.slice(2, 3);
  repos.videos.upsertMany(
    [
      ...[1, 2, 3, 4, 5].map((n) => video(`${tag}old${n}`, channelId, 1000, 30 + n)),
      video(`${tag}hit`, channelId, hit, 12),
    ],
    when,
  );
};

const refreshed = (when: Date): void =>
  repos.runs.record({
    startedAt: when,
    finishedAt: when,
    refreshed: 1,
    failed: 0,
    stoppedEarly: false,
  });

beforeEach(() => {
  const db = openDatabase(':memory:');
  repos = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    runs: new SqliteRefreshRepo(db),
    alerts: new SqliteAlertRepo(db),
  };
  clock = START;
  read(CENTER, START, 1000);
  read(PEER, START, 1000);
  repos.maps.create(
    {
      centerChannelId: CENTER,
      depth: 1,
      region: 'US',
      members: [
        { channelId: CENTER, steps: 0 },
        { channelId: PEER, steps: 1 },
      ],
    },
    START,
  );
  engine = alertsEngine({ now: () => clock, repos });
});

describe('alertsEngine', () => {
  test('has no rule at first, and gives the stated default and range', () => {
    expect(engine.findAlerts(CENTER)).toMatchObject({
      centerChannelId: CENTER,
      rule: null,
      defaultMinScore: DEFAULT_ALERT_MIN_SCORE,
      alerts: [],
      unread: 0,
      lastRefreshAt: null,
    });
  });

  test('saves a rule, then tells of what passes it after a refresh, and marks it read', () => {
    const saved = engine.saveAlertRule(CENTER, {
      minScore: 4,
      takenOff: true,
      enabled: true,
    });
    expect(saved?.rule).toEqual({
      minScore: 4,
      takenOff: true,
      enabled: true,
      createdAt: START.toISOString(),
      checkedAt: START.toISOString(),
    });

    clock = at(1);
    read(PEER, clock, 50_000);
    refreshed(clock);
    clock = at(1.1);

    expect(engine.alertCounts()).toEqual({ [CENTER]: 1 });
    const found = engine.findAlerts(CENTER);
    expect(found?.unread).toBe(1);
    expect(found?.lastRefreshAt).toBe(at(1).toISOString());
    expect(found?.alerts[0]).toMatchObject({
      kind: 'breakout',
      channelId: PEER,
      videoTitle: 'Title ahit',
      views: 50_000,
      read: false,
      foundAt: at(1.1).toISOString(),
    });

    expect(engine.markAlertsRead(CENTER)?.unread).toBe(0);
    expect(engine.alertCounts()).toEqual({});
  });

  test('shows a stated number of the newest alerts', () => {
    expect(ALERTS_SHOWN).toBe(30);
  });

  test('has nothing for a channel with no map', () => {
    expect(engine.findAlerts(NO_MAP)).toBeNull();
    expect(engine.saveAlertRule(NO_MAP, { minScore: 5, takenOff: true, enabled: true })).toBeNull();
    expect(engine.markAlertsRead(NO_MAP)).toBeNull();
  });
});

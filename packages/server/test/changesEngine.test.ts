import {
  SqliteChannelRepo,
  SqliteEdgeRepo,
  SqliteLookRepo,
  SqliteMapRepo,
  SqliteRefreshRepo,
  SqliteVideoRepo,
  openDatabase,
} from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { changesEngine } from '../src/changesEngine';
import type { ChangesEngine } from '../src/extrasTypes';

const DAY_MS = 86_400_000;
const START = new Date('2026-11-21T12:00:00Z');
const CENTER = `UC${'c'.repeat(22)}`;
const NO_MAP = `UC${'n'.repeat(22)}`;

let clock: Date;
let engine: ChangesEngine;

beforeEach(() => {
  const db = openDatabase(':memory:');
  const repos = {
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    runs: new SqliteRefreshRepo(db),
    looks: new SqliteLookRepo(db),
  };
  clock = START;
  repos.channels.upsert(
    {
      id: CENTER,
      title: 'Mine',
      handle: null,
      subscribers: 10,
      subscribersHidden: false,
      videoCount: null,
    },
    START,
  );
  repos.maps.create(
    { centerChannelId: CENTER, depth: 1, region: 'US', members: [{ channelId: CENTER, steps: 0 }] },
    START,
  );
  engine = changesEngine({ now: () => clock, repos });
});

describe('changesEngine', () => {
  test('answers for a week, and says so, until the channel has been marked as seen', () => {
    const reply = engine.findChanges(CENTER, 'last-look');

    expect(reply).toMatchObject({
      asked: 'last-look',
      sinceKind: 'week',
      lastLookAt: null,
      since: new Date(START.getTime() - 7 * DAY_MS).toISOString(),
    });
  });

  test('answers since the last look once the owner has marked the channel as seen', () => {
    expect(engine.markChangesSeen(CENTER)).toBe(START.toISOString());
    clock = new Date(START.getTime() + 2 * DAY_MS);

    expect(engine.findChanges(CENTER, 'last-look')).toMatchObject({
      sinceKind: 'last-look',
      lastLookAt: START.toISOString(),
      since: START.toISOString(),
      now: clock.toISOString(),
    });
    expect(engine.findChanges(CENTER, 'yesterday')).toMatchObject({
      sinceKind: 'yesterday',
      lastLookAt: START.toISOString(),
    });
  });

  test('has nothing to say, and nothing to mark, for a channel with no map', () => {
    expect(engine.findChanges(NO_MAP, 'week')).toBeNull();
    expect(engine.markChangesSeen(NO_MAP)).toBeNull();
  });
});

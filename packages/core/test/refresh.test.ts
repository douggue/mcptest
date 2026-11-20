import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, transactionRunner } from '../src/db/sqlite';
import {
  DEFAULT_REFRESH_MAX_CHANNELS,
  REFRESH_FAILURE_BACKOFF_HOURS,
  REFRESH_MAX_BACKOFF_HOURS,
  REFRESH_MAX_CONSECUTIVE_FAILURES,
  REFRESH_MIN_AGE_HOURS,
  loadRefreshStatus,
  pickStalest,
  refreshStalest,
  type RefreshDeps,
  type RefreshProgress,
} from '../src/refresh/refresh';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteEdgeRepo } from '../src/repos/sqliteEdgeRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteRefreshRepo } from '../src/repos/sqliteRefreshRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import { SqliteWatchlistRepo } from '../src/repos/sqliteWatchlistRepo';
import type { ReadFailure, StoredChannel } from '../src/repos/types';
import type { ChannelSnapshot, YouTubeSource } from '../src/sources/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (letter: string, n: number) => letter.repeat(10) + String(n);
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS);

/** Each read of a channel finds its one video with a thousand more views than the last. */
class FakeSource implements YouTubeSource {
  fetched: string[] = [];
  failing = new Set<string>();
  private reads = new Map<string, number>();

  async resolveChannelId(): Promise<string> {
    throw new Error('not used');
  }

  async fetchChannel(channelId: string): Promise<ChannelSnapshot> {
    const letter = channelId.charAt(2);
    this.fetched.push(letter);
    if (this.failing.has(letter)) throw new Error(`cannot read ${letter}`);
    const reads = (this.reads.get(letter) ?? 0) + 1;
    this.reads.set(letter, reads);
    return {
      channel: {
        id: channelId,
        title: `Channel ${letter}`,
        handle: `handle${letter}`,
        subscribers: 500,
        subscribersHidden: false,
        videoCount: 1,
      },
      videos: [
        {
          id: vid(letter, 1),
          channelId,
          title: `America just built machine ${letter}`,
          views: 1000 * reads,
          durationSeconds: 600,
          published: {
            date: new Date(NOW.getTime() - 3 * DAY_MS),
            precision: 'day',
            raw: '3d ago',
          },
        },
      ],
    };
  }

  async getSidebar(): Promise<readonly never[]> {
    return [];
  }
}

let source: FakeSource;
let deps: RefreshDeps;
let clock: Date;

/** Stores a channel as it was read `hours` ago. */
async function seed(letter: string, hours: number): Promise<void> {
  const at = hoursAgo(hours);
  const snapshot = await new FakeSource().fetchChannel(cid(letter));
  deps.channels.upsert(snapshot.channel, at);
  deps.videos.upsertMany(
    snapshot.videos.map((video) => ({ ...video, views: 500, published: video.published! })),
    at,
  );
}

beforeEach(() => {
  const db = openDatabase(':memory:');
  source = new FakeSource();
  clock = NOW;
  deps = {
    source,
    channels: new SqliteChannelRepo(db),
    videos: new SqliteVideoRepo(db),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    watchlist: new SqliteWatchlistRepo(db),
    runs: new SqliteRefreshRepo(db),
    transact: transactionRunner(db),
    now: () => clock,
  };
});

describe('pickStalest', () => {
  const channel = (letter: string, hours: number): StoredChannel => ({
    id: cid(letter),
    title: `Channel ${letter}`,
    handle: null,
    subscribers: 100,
    subscribersHidden: false,
    videoCount: 1,
    fetchedAt: hoursAgo(hours),
  });
  const pick = (channels: readonly StoredChannel[], priority: readonly string[], max = 10) =>
    pickStalest({ channels, priorityIds: new Set(priority.map(cid)), now: NOW, maxChannels: max })
      .map((picked) => picked.id.charAt(2))
      .join('');

  test('takes the channels read longest ago first', () => {
    expect(pick([channel('A', 30), channel('B', 90), channel('D', 50)], [])).toBe('BDA');
  });

  test('leaves alone a channel read within the last 20 hours', () => {
    const fresh = REFRESH_MIN_AGE_HOURS - 1;

    expect(
      pick([channel('A', fresh), channel('B', REFRESH_MIN_AGE_HOURS), channel('D', 0)], []),
    ).toBe('B');
  });

  test('puts the channels that matter to the owner ahead of older ones that do not', () => {
    const channels = [channel('A', 200), channel('B', 30), channel('D', 40), channel('E', 100)];

    expect(pick(channels, ['B', 'D'])).toBe('DBAE');
  });

  test('never puts a fresh channel in a run, however much it matters', () => {
    expect(pick([channel('A', 1), channel('B', 30)], ['A'])).toBe('B');
  });

  test('stops at the most channels a run may read', () => {
    const channels = ['A', 'B', 'D', 'E'].map((letter, index) => channel(letter, 100 - index));

    expect(pick(channels, [], 2)).toBe('AB');
  });

  const failed = (letter: string, failures: number, hours: number): ReadFailure => ({
    channelId: cid(letter),
    failures,
    lastFailedAt: hoursAgo(hours),
  });
  const pickWith = (
    channels: readonly StoredChannel[],
    failures: readonly ReadFailure[],
    priority: readonly string[] = [],
  ) =>
    pickStalest({
      channels,
      failures,
      priorityIds: new Set(priority.map(cid)),
      now: NOW,
      maxChannels: 10,
    })
      .map((picked) => picked.id.charAt(2))
      .join('');

  test('leaves alone a channel that could not be read a short while ago', () => {
    const channels = [channel('A', 900), channel('B', 30)];

    expect(pickWith(channels, [failed('A', 1, REFRESH_FAILURE_BACKOFF_HOURS - 1)])).toBe('B');
    expect(pickWith(channels, [failed('A', 1, REFRESH_FAILURE_BACKOFF_HOURS)])).toBe('BA');
  });

  test('waits twice as long after each further failure, up to a limit', () => {
    const channels = [channel('A', 9000)];
    const second = REFRESH_FAILURE_BACKOFF_HOURS * 2;

    expect(pickWith(channels, [failed('A', 2, second - 1)])).toBe('');
    expect(pickWith(channels, [failed('A', 2, second)])).toBe('A');
    expect(pickWith(channels, [failed('A', 40, REFRESH_MAX_BACKOFF_HOURS - 1)])).toBe('');
    expect(pickWith(channels, [failed('A', 40, REFRESH_MAX_BACKOFF_HOURS)])).toBe('A');
  });

  test('tries a channel that failed before only after every channel that did not', () => {
    const channels = [channel('A', 900), channel('B', 30), channel('D', 40)];

    expect(pickWith(channels, [failed('A', 1, 100)])).toBe('DBA');
    expect(pickWith(channels, [failed('A', 1, 100)], ['A'])).toBe('DBA');
  });
});

describe('refreshStalest', () => {
  test('reads the stalest channels again and stores a new view reading for each video', async () => {
    await seed('A', 50);
    await seed('B', 30);
    await seed('D', 2);

    const result = await refreshStalest(deps);

    expect(source.fetched).toEqual(['A', 'B']);
    expect(result).toMatchObject({
      picked: 2,
      refreshed: [cid('A'), cid('B')],
      failed: [],
      notAttempted: 0,
      stoppedEarly: false,
    });
    expect(deps.channels.findById(cid('A'))?.fetchedAt).toEqual(NOW);
    expect(deps.videos.listSnapshots(vid('A', 1)).map((reading) => reading.views)).toEqual([
      500, 1000,
    ]);
    expect(deps.videos.listSnapshots(vid('D', 1))).toHaveLength(1);
  });

  test('makes no request when every channel was read recently', async () => {
    await seed('A', 3);

    const result = await refreshStalest(deps);

    expect(source.fetched).toEqual([]);
    expect(result).toMatchObject({ picked: 0, refreshed: [], failed: [], stoppedEarly: false });
  });

  test('reads no more channels than the run allows, and says how many are still due', async () => {
    for (const [index, letter] of ['A', 'B', 'D', 'E'].entries()) await seed(letter, 90 - index);

    const result = await refreshStalest(deps, { maxChannels: 3 });

    expect(source.fetched).toEqual(['A', 'B', 'D']);
    expect(result.stillDue).toBe(1);
  });

  test('reads watched channels and the look-alikes on a map before the rest', async () => {
    await seed('C', 30);
    await seed('A', 30);
    await seed('W', 25);
    await seed('X', 200);
    await seed('Y', 300);
    deps.watchlist.setWatched(cid('W'), true, NOW);
    deps.maps.create(
      {
        centerChannelId: cid('C'),
        depth: 1,
        region: 'US',
        members: [
          { channelId: cid('C'), steps: 0 },
          { channelId: cid('A'), steps: 1 },
        ],
      },
      NOW,
    );

    await refreshStalest(deps, { maxChannels: 4 });

    expect(source.fetched.slice(0, 3).sort()).toEqual(['A', 'C', 'W']);
    expect(source.fetched[3]).toBe('Y');
  });

  test('carries on past a channel that cannot be read, and reports it', async () => {
    await seed('A', 50);
    await seed('B', 40);
    await seed('D', 30);
    source.failing.add('B');

    const result = await refreshStalest(deps);

    expect(result.refreshed).toEqual([cid('A'), cid('D')]);
    expect(result.failed).toEqual([{ channelId: cid('B'), error: 'cannot read B' }]);
    expect(result.stoppedEarly).toBe(false);
    expect(deps.channels.findById(cid('B'))?.fetchedAt).toEqual(hoursAgo(40));
  });

  test('stops early when YouTube refuses several channels in a row', async () => {
    const letters = ['A', 'B', 'D', 'E', 'F', 'G', 'H', 'I'];
    for (const [index, letter] of letters.entries()) await seed(letter, 100 - index);
    for (const letter of letters.slice(1)) source.failing.add(letter);

    const result = await refreshStalest(deps);

    expect(source.fetched).toHaveLength(1 + REFRESH_MAX_CONSECUTIVE_FAILURES);
    expect(result).toMatchObject({
      stoppedEarly: true,
      notAttempted: letters.length - 1 - REFRESH_MAX_CONSECUTIVE_FAILURES,
    });
    expect(result.refreshed).toEqual([cid('A')]);
    expect(result.failed).toHaveLength(REFRESH_MAX_CONSECUTIVE_FAILURES);
  });

  test('does not stop for failures that are not in a row', async () => {
    const letters = ['A', 'B', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    for (const [index, letter] of letters.entries()) await seed(letter, 100 - index);
    for (const letter of ['A', 'D', 'F', 'H', 'J', 'L']) source.failing.add(letter);

    const result = await refreshStalest(deps);

    expect(result.stoppedEarly).toBe(false);
    expect(result.failed).toHaveLength(6);
    expect(result.refreshed).toHaveLength(6);
  });

  test('does not let channels that are gone hold up the rest, run after run', async () => {
    const gone = ['A', 'B', 'D', 'E', 'F'];
    for (const [index, letter] of gone.entries()) await seed(letter, 500 - index);
    await seed('G', 30);
    await seed('H', 25);
    for (const letter of gone) source.failing.add(letter);

    const first = await refreshStalest(deps);
    clock = new Date(NOW.getTime() + 2 * HOUR_MS);
    source.fetched = [];
    const second = await refreshStalest(deps);

    expect(first).toMatchObject({ stoppedEarly: true, refreshed: [], notAttempted: 2 });
    expect(source.fetched).toEqual(['G', 'H']);
    expect(second).toMatchObject({
      refreshed: [cid('G'), cid('H')],
      failed: [],
      stoppedEarly: false,
      stillDue: 0,
    });
  });

  test('tries a channel that failed again once its wait is over, and forgets the failure when it reads', async () => {
    await seed('A', 50);
    source.failing.add('A');
    await refreshStalest(deps);
    source.failing.clear();
    source.fetched = [];

    clock = new Date(NOW.getTime() + (REFRESH_FAILURE_BACKOFF_HOURS - 1) * HOUR_MS);
    const early = await refreshStalest(deps);
    clock = new Date(NOW.getTime() + REFRESH_FAILURE_BACKOFF_HOURS * HOUR_MS);
    const due = await refreshStalest(deps);

    expect(early.picked).toBe(0);
    expect(due.refreshed).toEqual([cid('A')]);
    expect(deps.channels.listReadFailures()).toEqual([]);
  });

  test('reports progress after each channel', async () => {
    await seed('A', 50);
    await seed('B', 40);
    const seen: RefreshProgress[] = [];

    await refreshStalest(deps, { onProgress: (progress) => seen.push(progress) });

    expect(seen).toEqual([
      { stage: 'refreshing', done: 0, total: 2 },
      { stage: 'refreshing', done: 1, total: 2 },
      { stage: 'refreshing', done: 2, total: 2 },
    ]);
  });

  test.each([0, 1.5, 501])('rejects a run of %s channels', async (maxChannels) => {
    await expect(refreshStalest(deps, { maxChannels })).rejects.toThrow(/maxChannels/);
  });

  test('reads fifty channels a run unless told otherwise', () => {
    expect(DEFAULT_REFRESH_MAX_CHANNELS).toBe(50);
  });
});

describe('loadRefreshStatus', () => {
  test('says nothing has been refreshed on a new store', () => {
    expect(loadRefreshStatus(deps, NOW)).toEqual({
      last: null,
      channels: 0,
      due: 0,
      oldestReadAt: null,
    });
  });

  test('reports the last run and how many channels are due', async () => {
    await seed('A', 50);
    await seed('B', 40);
    await seed('D', 1);
    source.failing.add('B');
    const started = NOW;
    await refreshStalest({
      ...deps,
      now: () => {
        const at = clock;
        clock = new Date(clock.getTime() + 60_000);
        return at;
      },
    });

    const status = loadRefreshStatus(deps, clock);

    expect(status.last).toMatchObject({
      startedAt: started.toISOString(),
      refreshed: 1,
      failed: 1,
      stoppedEarly: false,
    });
    expect(new Date(status.last!.finishedAt).getTime()).toBeGreaterThan(started.getTime());
    // The channel that failed a minute ago is not due again yet.
    expect(status).toMatchObject({ channels: 3, due: 0, oldestReadAt: hoursAgo(40).toISOString() });
  });
});

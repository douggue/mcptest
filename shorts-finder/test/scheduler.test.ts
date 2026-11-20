import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SHUTDOWN, type StopReason } from '../src/cycleStop';
import { openDatabase, type Db } from '../src/db/sqlite';
import { READING_ELSEWHERE, YOUTUBE_LEASE_TTL_MS } from '../src/lease';
import { SqliteLeaseRepo } from '../src/repos/sqliteLeaseRepo';
import {
  RATE_LIMIT_PAUSE_MS,
  READ_CYCLE_EVERY_MS,
  SCHEDULER_TICK_MS,
  startScheduler,
  type CycleRecord,
  type Scheduler,
  type SchedulerDeps,
} from '../src/schedule/scheduler';
import { DAY_MS, HOUR_MS, MINUTE_MS, NOW, at } from './fixtures/facts';

let db: Db;
let leases: SqliteLeaseRepo;
let scheduler: Scheduler | null;

beforeEach(() => {
  db = openDatabase(':memory:');
  leases = new SqliteLeaseRepo(db);
  scheduler = null;
});

afterEach(async () => {
  await scheduler?.stop();
  vi.useRealTimers();
  db.close();
});

type Work = (signal: AbortSignal) => Promise<{ stopped: StopReason | null }>;

interface Loop {
  clock: Date;
  /** The names of the work started, in order. */
  readonly started: string[];
  readonly records: CycleRecord[];
  searchDue: boolean;
  timerStopped: boolean;
  /** Fires the timer once and waits for the look it starts to finish. */
  beat(): Promise<void>;
  /** Moves the clock on, then fires the timer. */
  after(ms: number): Promise<void>;
  start(overrides?: Partial<SchedulerDeps>): Promise<void>;
  fire(): void;
}

const done = async (): Promise<{ stopped: StopReason | null }> => ({ stopped: null });

/** A scheduler over a clock and a timer the test drives, with work that only notes it ran. */
function makeLoop(): Loop {
  let run: () => void = () => undefined;
  const noting =
    (name: string, work: Work = done): Work =>
    (signal) => {
      loop.started.push(name);
      return work(signal);
    };
  const loop: Loop = {
    clock: NOW,
    started: [],
    records: [],
    searchDue: false,
    timerStopped: false,
    fire: () => run(),
    async beat() {
      run();
      await scheduler?.whenIdle();
    },
    async after(ms) {
      loop.clock = new Date(loop.clock.getTime() + ms);
      await loop.beat();
    },
    async start(overrides = {}) {
      const { readCycle, channelReads, searchCycle, ...rest } = overrides;
      scheduler = startScheduler({
        lease: { leases, now: () => loop.clock },
        now: () => loop.clock,
        readCycle: noting('read', readCycle),
        channelReads: noting('channels', channelReads),
        searchCycle: noting('search', searchCycle),
        searchIsDue: () => loop.searchDue,
        dailyCleanup: () => {
          loop.started.push('cleanup');
          return { removed: 0 };
        },
        record: (entry) => loop.records.push(entry),
        every: (tick, ms) => {
          run = tick;
          expect(ms).toBe(SCHEDULER_TICK_MS);
          return 'timer';
        },
        stop: () => {
          loop.timerStopped = true;
        },
        ...rest,
      });
      await scheduler.whenIdle();
    },
  };
  return loop;
}

const results = (loop: Loop): string[] =>
  loop.records.map((entry) => `${entry.cycle}:${entry.result}`);

describe('the scheduler', () => {
  test('takes a round of readings, reads queued channels and thins old readings as soon as it starts', async () => {
    const loop = makeLoop();

    await loop.start();

    expect(loop.started).toEqual(['read', 'channels', 'cleanup']);
    expect(results(loop)).toEqual(['read:done', 'channels:done', 'cleanup:done']);
    expect(loop.records[0]).toEqual({
      cycle: 'read',
      startedAt: NOW,
      result: 'done',
      report: { stopped: null },
      reason: null,
    });
  });

  test('reads followed channels’ uploads lists after the channels, each round of readings', async () => {
    const loop = makeLoop();

    await loop.start({
      uploadsCycle: async () => {
        loop.started.push('uploads');
        return { stopped: null };
      },
    });

    expect(loop.started).toEqual(['read', 'channels', 'uploads', 'cleanup']);
    expect(results(loop)).toContain('uploads:done');
  });

  test('reads followed channels’ feeds in every look, after the searching, recording only rounds that had work', async () => {
    const loop = makeLoop();
    loop.searchDue = true;
    const answers: Array<{ stopped: null } | null> = [{ stopped: null }, null, { stopped: null }];
    const signals: AbortSignal[] = [];

    await loop.start({
      feedCycle: async (signal) => {
        loop.started.push('feeds');
        signals.push(signal);
        return answers.shift() ?? null;
      },
    });
    loop.searchDue = false;
    await loop.after(SCHEDULER_TICK_MS);
    await loop.after(SCHEDULER_TICK_MS);

    expect(loop.started).toEqual([
      'read',
      'channels',
      'search',
      'feeds',
      'cleanup',
      'feeds',
      'feeds',
    ]);
    expect(results(loop).filter((entry) => entry.startsWith('feeds'))).toEqual([
      'feeds:done',
      'feeds:done',
    ]);
    expect(signals[0]?.aborted).toBe(false);
  });

  test('holds the feeds back during a pause, and starts one when their details were told to slow down', async () => {
    const loop = makeLoop();
    let feeds = 0;

    await loop.start({
      feedCycle: async () => {
        feeds += 1;
        return { stopped: 'rate_limit' };
      },
    });
    await loop.after(SCHEDULER_TICK_MS);
    await loop.after(SCHEDULER_TICK_MS);
    expect(feeds).toBe(1);
    await loop.after(SCHEDULER_TICK_MS);

    expect(feeds).toBe(2);
  });

  test('records a round of feeds that fails and carries on', async () => {
    const loop = makeLoop();

    await loop.start({
      feedCycle: async () => {
        throw new Error('the store is busy');
      },
    });

    expect(loop.records).toContainEqual({
      cycle: 'feeds',
      startedAt: NOW,
      result: 'failed',
      report: null,
      reason: 'the store is busy',
    });
    expect(loop.started).toContain('cleanup');
  });

  test('holds the YouTube lease while a cycle runs and gives it back after', async () => {
    const loop = makeLoop();
    const holders: Array<string | null> = [];

    await loop.start({
      readCycle: async () => {
        holders.push(leases.holder(loop.clock));
        return { stopped: null };
      },
    });

    expect(holders[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(leases.holder(loop.clock)).toBeNull();
  });

  test('looks every five minutes and takes the next round of readings an hour after the last', async () => {
    const loop = makeLoop();
    await loop.start();
    loop.started.length = 0;

    for (let look = 1; look < READ_CYCLE_EVERY_MS / SCHEDULER_TICK_MS; look += 1) {
      await loop.after(SCHEDULER_TICK_MS);
    }
    expect(loop.started).toEqual([]);
    await loop.after(SCHEDULER_TICK_MS);

    expect(loop.started).toEqual(['read', 'channels']);
    expect(SCHEDULER_TICK_MS).toBe(5 * MINUTE_MS);
    expect(READ_CYCLE_EVERY_MS).toBe(HOUR_MS);
  });

  test('searches when subjects are due, between rounds of readings', async () => {
    const loop = makeLoop();
    await loop.start();
    loop.started.length = 0;

    await loop.after(SCHEDULER_TICK_MS);
    loop.searchDue = true;
    await loop.after(SCHEDULER_TICK_MS);
    loop.searchDue = false;
    await loop.after(SCHEDULER_TICK_MS);

    expect(loop.started).toEqual(['search']);
  });

  test('never starts a second look while one is still working', async () => {
    const loop = makeLoop();
    let finish: () => void = () => undefined;
    const slow = new Promise<{ stopped: null }>((resolve) => {
      finish = () => resolve({ stopped: null });
    });
    const starting = loop.start({ readCycle: () => slow });

    loop.fire();
    loop.fire();
    finish();
    await starting;

    expect(loop.started.filter((name) => name === 'read')).toHaveLength(1);
  });

  test('records a cycle that fails and carries on with the rest and with the next hour', async () => {
    const loop = makeLoop();
    loop.searchDue = true;
    let fail = true;

    await loop.start({
      readCycle: async () => {
        if (fail) throw new Error('the reading failed');
        return { stopped: null };
      },
    });
    fail = false;
    await loop.after(SCHEDULER_TICK_MS);
    await loop.after(READ_CYCLE_EVERY_MS);

    expect(loop.records[0]).toMatchObject({
      cycle: 'read',
      result: 'failed',
      reason: 'the reading failed',
    });
    expect(results(loop)).toEqual([
      'read:failed',
      'channels:done',
      'search:done',
      'cleanup:done',
      'search:done',
      'read:done',
      'channels:done',
      'search:done',
    ]);
  });

  test('skips work while another program reads YouTube, and tries again at the next look', async () => {
    const loop = makeLoop();
    leases.acquire('by-hand', NOW, at(YOUTUBE_LEASE_TTL_MS));

    await loop.start();
    expect(loop.started).toEqual(['cleanup']);
    expect(loop.records[0]).toMatchObject({
      cycle: 'read',
      result: 'skipped',
      reason: READING_ELSEWHERE,
    });
    leases.release('by-hand');
    await loop.after(SCHEDULER_TICK_MS);

    expect(loop.started).toEqual(['cleanup', 'read', 'channels']);
  });

  test('asks nothing of YouTube for a quarter of an hour after being told it asks too fast', async () => {
    const loop = makeLoop();
    loop.searchDue = true;

    await loop.start({ readCycle: async () => ({ stopped: 'rate_limit' }) });
    await loop.after(SCHEDULER_TICK_MS);
    await loop.after(SCHEDULER_TICK_MS);
    expect(loop.started).toEqual(['read', 'cleanup']);
    await loop.after(SCHEDULER_TICK_MS);

    expect(loop.started).toEqual(['read', 'cleanup', 'search']);
    expect(RATE_LIMIT_PAUSE_MS).toBe(15 * MINUTE_MS);
  });

  test('thins old readings once on each UTC day, and tries a thinning that failed again at the next look', async () => {
    const loop = makeLoop();
    let runs = 0;
    await loop.start({
      dailyCleanup: () => {
        runs += 1;
        if (runs === 2) throw new Error('the store is busy');
        return { removed: 3 };
      },
    });

    await loop.after(SCHEDULER_TICK_MS);
    // NOW is 20:00 UTC: four hours on is the next day.
    await loop.after(4 * HOUR_MS);
    await loop.after(SCHEDULER_TICK_MS);
    await loop.after(SCHEDULER_TICK_MS);
    await loop.after(DAY_MS);

    expect(runs).toBe(4);
    const cleanups = loop.records.filter((entry) => entry.cycle === 'cleanup');
    expect(cleanups.map((entry) => entry.result)).toEqual(['done', 'failed', 'done', 'done']);
    expect(cleanups[0]?.report).toEqual({ removed: 3 });
    expect(cleanups[1]?.reason).toBe('the store is busy');
    expect(cleanups[2]?.startedAt).toEqual(at(4 * HOUR_MS + 2 * SCHEDULER_TICK_MS));
  });

  test('takes a round of readings at once when the clock has been set back past the last one', async () => {
    const loop = makeLoop();
    await loop.start();
    loop.started.length = 0;

    await loop.after(-2 * HOUR_MS);

    expect(loop.started).toEqual(['read', 'channels']);
  });

  test('records it and searches nothing when it cannot tell whether subjects are due', async () => {
    const loop = makeLoop();

    await loop.start({
      searchIsDue: () => {
        throw new Error('the store is closed');
      },
    });

    expect(loop.started).not.toContain('search');
    expect(loop.records).toContainEqual({
      cycle: 'search',
      startedAt: NOW,
      result: 'failed',
      report: null,
      reason: 'the store is closed',
    });
  });

  test('carries on when the recorder itself fails', async () => {
    const loop = makeLoop();

    await loop.start({
      record: () => {
        throw new Error('nowhere to write');
      },
    });
    await loop.after(READ_CYCLE_EVERY_MS);

    expect(loop.started.filter((name) => name === 'read')).toHaveLength(2);
  });
});

describe('stopping the scheduler', () => {
  test('tells running work to stop, which it does between requests', async () => {
    const loop = makeLoop();
    const reasons: unknown[] = [];
    let release: () => void = () => undefined;
    const request = new Promise<void>((resolve) => {
      release = resolve;
    });
    void loop.start({
      readCycle: async (signal) => {
        await request;
        reasons.push(signal.aborted, signal.reason);
        return { stopped: signal.aborted ? 'shutdown' : null };
      },
    });

    const stopping = scheduler!.stop();
    release();
    await stopping;

    expect(reasons).toEqual([true, SHUTDOWN]);
    expect(loop.records[0]).toMatchObject({ cycle: 'read', report: { stopped: 'shutdown' } });
    expect(loop.started).toEqual(['read']);
  });

  test('lets the running cycle finish, starts nothing after it and stops the timer', async () => {
    const loop = makeLoop();
    loop.searchDue = true;
    let finish: () => void = () => undefined;
    const slow = new Promise<{ stopped: null }>((resolve) => {
      finish = () => resolve({ stopped: null });
    });
    let finished = false;
    void loop.start({
      readCycle: async () => {
        const report = await slow;
        finished = true;
        return report;
      },
    });

    const stopping = scheduler!.stop();
    finish();
    await stopping;
    loop.fire();
    await scheduler!.whenIdle();

    expect(finished).toBe(true);
    expect(loop.started).toEqual(['read']);
    expect(results(loop)).toEqual(['read:done']);
    expect(loop.timerStopped).toBe(true);
  });

  test('runs on a real timer when given none, and stops it', async () => {
    vi.useFakeTimers({ now: NOW });
    const loop = makeLoop();
    loop.searchDue = true;
    await loop.start({ every: undefined, stop: undefined, now: () => new Date() });
    loop.started.length = 0;

    await vi.advanceTimersByTimeAsync(SCHEDULER_TICK_MS);
    expect(loop.started).toEqual(['search']);
    await scheduler!.stop();
    await vi.advanceTimersByTimeAsync(3 * SCHEDULER_TICK_MS);

    expect(loop.started).toEqual(['search']);
  });
});

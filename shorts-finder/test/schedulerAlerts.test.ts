import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import { SqliteLeaseRepo } from '../src/repos/sqliteLeaseRepo';
import {
  LAST_READ_AT,
  LAST_ROLLUP_DAY,
  READ_CYCLE_EVERY_MS,
  SCHEDULER_TICK_MS,
  startScheduler,
  type CycleRecord,
  type Scheduler,
  type SchedulerDeps,
  type SchedulerMemory,
} from '../src/schedule/scheduler';
import { DAY_MS, HOUR_MS, NOW, at } from './fixtures/facts';

let db: Db;
let scheduler: Scheduler | null;
let clock: Date;
let started: string[];
let records: CycleRecord[];
let fire: () => void;

beforeEach(() => {
  db = openDatabase(':memory:');
  scheduler = null;
  clock = NOW;
  started = [];
  records = [];
  fire = () => undefined;
});

afterEach(async () => {
  await scheduler?.stop();
  db.close();
});

const note =
  <T>(name: string, answer: T) =>
  async (): Promise<T> => {
    started.push(name);
    return answer;
  };

/** A memory that is a plain map, as the store's `service_state` would be. */
function mapMemory(
  values: Record<string, string> = {},
): SchedulerMemory & { values: Map<string, string> } {
  const map = new Map(Object.entries(values));
  return {
    values: map,
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
  };
}

async function start(overrides: Partial<SchedulerDeps> = {}): Promise<void> {
  scheduler = startScheduler({
    lease: { leases: new SqliteLeaseRepo(db), now: () => clock },
    now: () => clock,
    readCycle: note('read', { stopped: null }),
    channelReads: note('channels', { stopped: null }),
    searchCycle: note('search', { stopped: null }),
    searchIsDue: () => false,
    dailyRollup: () => {
      started.push('rollup');
      return { removed: 0 };
    },
    record: (entry) => records.push(entry),
    every: (run) => {
      fire = run;
      return 'timer';
    },
    stop: () => undefined,
    ...overrides,
  });
  await scheduler.whenIdle();
}

async function after(ms: number): Promise<void> {
  clock = new Date(clock.getTime() + ms);
  fire();
  await scheduler?.whenIdle();
}

const results = (): string[] => records.map((entry) => `${entry.cycle}:${entry.result}`);

describe("the scheduler and the owner's messages", () => {
  test('sends alerts and the daily messages after the readings, before the thinning', async () => {
    await start({
      alertCycle: note('alerts', { sent: 1 }),
      dailyMessages: note('daily', { digest: 'sent' }),
    });

    expect(started).toEqual(['read', 'channels', 'alerts', 'daily', 'rollup']);
    expect(results()).toEqual([
      'read:done',
      'channels:done',
      'alerts:done',
      'daily:done',
      'rollup:done',
    ]);
    expect(records[2]?.report).toEqual({ sent: 1 });
  });

  test('looks for alerts to send in every look, not only after a round of readings', async () => {
    await start({ alertCycle: note('alerts', { sent: 0 }) });
    started.length = 0;

    await after(SCHEDULER_TICK_MS);

    expect(started).toEqual(['alerts']);
  });

  test('records nothing when the alerts and the daily messages had nothing to try', async () => {
    await start({ alertCycle: note('alerts', null), dailyMessages: note('daily', undefined) });

    expect(started).toContain('alerts');
    expect(results()).toEqual(['read:done', 'channels:done', 'rollup:done']);
  });

  test('sends alerts without the YouTube lease, even while another program holds it', async () => {
    new SqliteLeaseRepo(db).acquire('another program', clock, at(DAY_MS));

    await start({ alertCycle: note('alerts', { sent: 2 }) });

    expect(results()).toEqual(['read:skipped', 'channels:skipped', 'alerts:done', 'rollup:done']);
  });

  test('records alerts that fail and carries on', async () => {
    await start({
      alertCycle: async () => {
        throw new Error('the store was busy');
      },
      dailyMessages: note('daily', { heartbeat: 'sent' }),
    });

    expect(records.find((entry) => entry.cycle === 'alerts')).toMatchObject({
      result: 'failed',
      reason: 'the store was busy',
    });
    expect(results()).toContain('daily:done');
  });

  test('starts no messages once it is stopping', async () => {
    let finish: () => void = () => undefined;
    const slow = new Promise<{ stopped: null }>((resolve) => {
      finish = () => resolve({ stopped: null });
    });
    const starting = start({ readCycle: () => slow, alertCycle: note('alerts', { sent: 1 }) });
    await Promise.resolve();

    const stopping = scheduler!.stop();
    finish();
    await stopping;
    await starting;

    expect(started).not.toContain('alerts');
  });
});

describe("the scheduler's memory", () => {
  test('notes when it last read and which day it last thinned', async () => {
    const memory = mapMemory();

    await start({ memory });

    expect(memory.values.get(LAST_READ_AT)).toBe(NOW.toISOString());
    expect(memory.values.get(LAST_ROLLUP_DAY)).toBe('2026-11-20');
  });

  test('does not read or thin again at once after a restart within the hour', async () => {
    const memory = mapMemory({
      [LAST_READ_AT]: at(-20 * 60_000).toISOString(),
      [LAST_ROLLUP_DAY]: '2026-11-20',
    });

    await start({ memory });
    expect(started).toEqual([]);
    await after(READ_CYCLE_EVERY_MS - 20 * 60_000);

    expect(started).toEqual(['read', 'channels']);
  });

  test('reads at once after a restart when the last round was over an hour ago', async () => {
    const memory = mapMemory({ [LAST_READ_AT]: at(-2 * HOUR_MS).toISOString() });

    await start({ memory });

    expect(started).toEqual(['read', 'channels', 'rollup']);
  });

  test.each([
    ['not a time', 'not a time'],
    ['still to come', at(HOUR_MS).toISOString()],
  ])('reads at once when the remembered time is %s', async (_name, value) => {
    await start({ memory: mapMemory({ [LAST_READ_AT]: value }) });

    expect(started).toContain('read');
  });

  test('carries on when the memory cannot be read or written', async () => {
    const broken: SchedulerMemory = {
      get: () => {
        throw new Error('the store is closed');
      },
      set: () => {
        throw new Error('the store is closed');
      },
    };

    await start({ memory: broken });
    await after(READ_CYCLE_EVERY_MS);

    expect(started.filter((name) => name === 'read')).toHaveLength(2);
    expect(results().every((result) => result.endsWith(':done'))).toBe(true);
  });

  test('does not note a round of readings that another program kept from starting', async () => {
    const memory = mapMemory();
    new SqliteLeaseRepo(db).acquire('another program', clock, at(DAY_MS));

    await start({ memory });

    expect(memory.values.has(LAST_READ_AT)).toBe(false);
  });
});

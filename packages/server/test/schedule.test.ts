import { describe, expect, test, vi } from 'vitest';
import { createApp } from '../src/app';
import { JobStore } from '../src/jobs';
import {
  FIRST_REFRESH_DELAY_MS,
  REFRESH_RETRY_MS,
  startRefreshTimer,
  startThroughApi,
  type TimerOptions,
} from '../src/schedule';
import { HOST, stubEngine } from './support';

const HOUR_MS = 3_600_000;

/** A clock the test winds by hand: `fire` runs the callback that is waiting. */
function fakeTimers() {
  const waits: number[] = [];
  let waiting: (() => void) | null = null;
  let cleared = 0;
  return {
    waits,
    get cleared() {
      return cleared;
    },
    get pending() {
      return waiting !== null;
    },
    setTimer: ((run, ms) => {
      waits.push(ms);
      waiting = run;
      return waits.length;
    }) satisfies TimerOptions['setTimer'],
    clearTimer: (() => {
      cleared += 1;
      waiting = null;
    }) satisfies TimerOptions['clearTimer'],
    async fire() {
      const run = waiting;
      waiting = null;
      run?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe('startRefreshTimer', () => {
  test('waits a minute after start, then refreshes every N hours', async () => {
    const timers = fakeTimers();
    let starts = 0;
    startRefreshTimer({
      everyHours: 6,
      start: async () => {
        starts += 1;
        return true;
      },
      ...timers,
    });

    expect(starts).toBe(0);
    await timers.fire();
    await timers.fire();

    expect(starts).toBe(2);
    expect(timers.waits).toEqual([FIRST_REFRESH_DELAY_MS, 6 * HOUR_MS, 6 * HOUR_MS]);
  });

  test('tries again soon when a map is being made, instead of losing the turn', async () => {
    const timers = fakeTimers();
    const answers = [false, true];
    startRefreshTimer({ everyHours: 24, start: async () => answers.shift() ?? true, ...timers });

    await timers.fire();
    await timers.fire();

    expect(timers.waits).toEqual([FIRST_REFRESH_DELAY_MS, REFRESH_RETRY_MS, 24 * HOUR_MS]);
  });

  test('reports a refresh that could not be started and keeps to the schedule', async () => {
    const timers = fakeTimers();
    const problems: string[] = [];
    startRefreshTimer({
      everyHours: 12,
      start: async () => {
        throw new Error('store is locked');
      },
      onProblem: (message) => problems.push(message),
      ...timers,
    });

    await timers.fire();

    expect(problems).toEqual(['store is locked']);
    expect(timers.waits).toEqual([FIRST_REFRESH_DELAY_MS, 12 * HOUR_MS]);
    expect(timers.pending).toBe(true);
  });

  test('stops when told to', async () => {
    const timers = fakeTimers();
    let starts = 0;
    const timer = startRefreshTimer({
      everyHours: 6,
      start: async () => {
        starts += 1;
        return true;
      },
      ...timers,
    });

    timer.stop();
    await timers.fire();

    expect(starts).toBe(0);
    expect(timers.cleared).toBe(1);
    expect(timers.pending).toBe(false);
  });

  test('does not schedule another turn when stopped while a refresh was starting', async () => {
    const timers = fakeTimers();
    let release: (started: boolean) => void = () => {};
    const timer = startRefreshTimer({
      everyHours: 6,
      start: () => new Promise<boolean>((resolve) => (release = resolve)),
      ...timers,
    });

    const fired = timers.fire();
    timer.stop();
    release(true);
    await fired;

    expect(timers.waits).toEqual([FIRST_REFRESH_DELAY_MS]);
  });

  test('runs on the real clock when no other is given, and stops with it', async () => {
    vi.useFakeTimers();
    try {
      let starts = 0;
      const timer = startRefreshTimer({
        everyHours: 1,
        start: async () => {
          starts += 1;
          return true;
        },
      });

      await vi.advanceTimersByTimeAsync(FIRST_REFRESH_DELAY_MS);
      expect(starts).toBe(1);
      await vi.advanceTimersByTimeAsync(HOUR_MS);
      expect(starts).toBe(2);

      timer.stop();
      await vi.advanceTimersByTimeAsync(3 * HOUR_MS);
      expect(starts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('startThroughApi', () => {
  const outcome = {
    refreshed: 0,
    failed: 0,
    notAttempted: 0,
    stoppedEarly: false,
    stillDue: 0,
    factsAdded: 0,
    factsProblem: null,
  };

  test('starts a refresh through the same route as the button, one at a time', async () => {
    let runs = 0;
    let finish: () => void = () => {};
    const app = createApp({
      engine: stubEngine({
        refresh: () => {
          runs += 1;
          return new Promise((resolve) => (finish = () => resolve(outcome)));
        },
      }),
      jobs: new JobStore(),
      allowedHosts: [HOST],
    });
    const start = startThroughApi(app, HOST);

    expect(await start()).toBe(true);
    expect(await start()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await start()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs).toBe(2);
  });

  test('fails loudly when the route refuses for any other reason', async () => {
    const app = createApp({ engine: stubEngine({}), jobs: new JobStore(), allowedHosts: [HOST] });

    await expect(startThroughApi(app, 'other.example:1')()).rejects.toThrow(/403/);
  });
});

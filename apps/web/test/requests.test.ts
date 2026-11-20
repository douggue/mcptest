import { describe, expect, test } from 'vitest';
import { followJob, oneAtATime, requestCounter } from '../src/lib/requests';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A clock a test moves by hand: `tick` runs the one timer that is waiting. */
function manualClock() {
  let waiting: (() => void) | null = null;
  let set = 0;
  return {
    setTimer: (run: () => void) => {
      waiting = run;
      set += 1;
      return set;
    },
    clearTimer: () => {
      waiting = null;
    },
    tick: () => {
      const run = waiting;
      waiting = null;
      run?.();
    },
    isWaiting: () => waiting !== null,
    timersSet: () => set,
  };
}

describe('oneAtATime', () => {
  test('ignores a second start while the first is still under way', async () => {
    const first = deferred<void>();
    const started: string[] = [];
    const start = oneAtATime((name: string) => {
      started.push(name);
      return first.promise;
    });

    expect(start('first click')).toBe(true);
    expect(start('second click')).toBe(false);
    first.resolve();
    await settle();

    expect(started).toEqual(['first click']);
    expect(start('later')).toBe(true);
    expect(started).toEqual(['first click', 'later']);
  });

  test('can start again after the work could not even begin', () => {
    let attempts = 0;
    const start = oneAtATime(() => {
      attempts += 1;
      throw new Error('broken');
    });

    expect(() => start()).toThrow('broken');
    expect(() => start()).toThrow('broken');
    expect(attempts).toBe(2);
  });

  test('can start again after the work failed', async () => {
    const start = oneAtATime(() => Promise.reject(new Error('refused')));

    expect(start()).toBe(true);
    await settle();

    expect(start()).toBe(true);
  });
});

describe('requestCounter', () => {
  test('says only the request begun last is the latest', () => {
    const requests = requestCounter();

    const older = requests.begin();
    expect(older()).toBe(true);
    const newer = requests.begin();

    expect(older()).toBe(false);
    expect(newer()).toBe(true);
  });
});

describe('followJob', () => {
  type Reading = { readonly done: boolean };

  test('reads the job again only after the last reading came back', async () => {
    const clock = manualClock();
    const reads: Array<ReturnType<typeof deferred<Reading>>> = [];
    followJob<Reading>({
      read: () => {
        const next = deferred<Reading>();
        reads.push(next);
        return next.promise;
      },
      onReading: (job) => job.done,
      onLost: () => {},
      intervalMs: 1500,
      ...clock,
    });

    clock.tick();
    expect(reads).toHaveLength(1);
    // The reading is slow: no second one is asked for meanwhile.
    expect(clock.isWaiting()).toBe(false);
    reads[0]!.resolve({ done: false });
    await settle();
    expect(clock.isWaiting()).toBe(true);
    clock.tick();

    expect(reads).toHaveLength(2);
  });

  test('stops asking once the job is over, and says so once', async () => {
    const clock = manualClock();
    const seen: Reading[] = [];
    followJob<Reading>({
      read: async () => ({ done: true }),
      onReading: (job) => {
        seen.push(job);
        return job.done;
      },
      onLost: () => {},
      intervalMs: 1500,
      ...clock,
    });

    clock.tick();
    await settle();
    clock.tick();
    await settle();

    expect(seen).toEqual([{ done: true }]);
    expect(clock.isWaiting()).toBe(false);
  });

  test('reports a reading that failed once and stops', async () => {
    const clock = manualClock();
    const lost: unknown[] = [];
    followJob<Reading>({
      read: () => Promise.reject(new Error('gone')),
      onReading: () => false,
      onLost: (error) => lost.push(error),
      intervalMs: 1500,
      ...clock,
    });

    clock.tick();
    await settle();

    expect(lost).toEqual([new Error('gone')]);
    expect(clock.isWaiting()).toBe(false);
  });

  test('says nothing about a reading that comes back after it was told to stop', async () => {
    const clock = manualClock();
    const reading = deferred<Reading>();
    const seen: Reading[] = [];
    const stop = followJob<Reading>({
      read: () => reading.promise,
      onReading: (job) => {
        seen.push(job);
        return job.done;
      },
      onLost: () => seen.push({ done: false }),
      intervalMs: 1500,
      ...clock,
    });

    clock.tick();
    stop();
    reading.resolve({ done: true });
    await settle();

    expect(seen).toEqual([]);
    expect(clock.isWaiting()).toBe(false);
  });

  test('waits on the real clock when given none', async () => {
    const seen: Reading[] = [];
    const stop = followJob<Reading>({
      read: async () => ({ done: true }),
      onReading: (job) => {
        seen.push(job);
        return true;
      },
      onLost: () => {},
      intervalMs: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();

    expect(seen).toEqual([{ done: true }]);
  });
});

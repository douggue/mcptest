/**
 * Small guards for requests a screen makes: one start at a time, only the
 * newest answer counts, and a job is polled one reading after another.
 */

/**
 * Wraps a start so that a second call while the first is still under way does
 * nothing (a double click). Answers whether the work was started.
 */
export function oneAtATime<A extends readonly unknown[]>(
  work: (...args: A) => Promise<unknown>,
): (...args: A) => boolean {
  let underWay = false;
  return (...args) => {
    if (underWay) return false;
    underWay = true;
    const free = (): void => {
      underWay = false;
    };
    try {
      work(...args).then(free, free);
    } catch (error) {
      free();
      throw error;
    }
    return true;
  };
}

export interface RequestCounter {
  /** Notes that a request is being made; the answer says whether it is still the newest. */
  begin(): () => boolean;
}

/**
 * Tells the newest request from older ones, so a slow answer to an earlier
 * request cannot replace what a later one already showed.
 */
export function requestCounter(): RequestCounter {
  let newest = 0;
  return {
    begin() {
      newest += 1;
      const mine = newest;
      return () => mine === newest;
    },
  };
}

export interface FollowOptions<J> {
  /** Reads the job's state. */
  readonly read: () => Promise<J>;
  /** Told each reading; answers true when the job is over and no more should be asked for. */
  readonly onReading: (job: J) => boolean;
  /** Told when a reading failed; no more are asked for. */
  readonly onLost: (error: unknown) => void;
  readonly intervalMs: number;
  /** Replace the clock; used by tests. */
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

const defaultSetTimer = (run: () => void, ms: number): unknown => setTimeout(run, ms);
const defaultClearTimer = (handle: unknown): void => {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
};

/**
 * Polls a job until it is over. Each reading is asked for only after the last
 * one came back, so slow answers cannot pile up or arrive out of order, and
 * the end is reported once. Returns a function that stops the polling; a
 * reading that comes back after that is ignored.
 */
export function followJob<J>(options: FollowOptions<J>): () => void {
  const setTimer = options.setTimer ?? defaultSetTimer;
  const clearTimer = options.clearTimer ?? defaultClearTimer;
  let finished = false;
  let handle: unknown = null;

  const wait = (): void => {
    handle = setTimer(turn, options.intervalMs);
  };
  const turn = (): void => {
    options.read().then(
      (job) => {
        if (finished) return;
        finished = options.onReading(job);
        if (!finished) wait();
      },
      (error: unknown) => {
        if (finished) return;
        finished = true;
        options.onLost(error);
      },
    );
  };
  wait();

  return () => {
    finished = true;
    clearTimer(handle);
  };
}

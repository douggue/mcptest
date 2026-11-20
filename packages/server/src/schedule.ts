/**
 * The optional timer that refreshes the store while the server runs, so that
 * a computer left on (or a small server) builds up history without anyone
 * pressing a button. It is off unless JGTUBE_REFRESH_HOURS is set.
 */

const HOUR_MS = 60 * 60 * 1000;
/**
 * The first turn comes a minute after start, not a full interval later: a
 * computer that is switched on for an hour a day would otherwise never reach
 * it. A refresh only reads channels not read in the last day, so starting the
 * server often does not mean reading YouTube often.
 */
export const FIRST_REFRESH_DELAY_MS = 60 * 1000;
/** When a map is being made at its turn, the timer comes back this soon. */
export const REFRESH_RETRY_MS = 15 * 60 * 1000;

export interface TimerOptions {
  /** Hours between refreshes. */
  readonly everyHours: number;
  /** Starts a refresh. False means another job is running and none was started. */
  readonly start: () => Promise<boolean>;
  /** Told when a refresh could not be started at all. */
  readonly onProblem?: (message: string) => void;
  /** Replace the clock; used by tests. */
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface RefreshTimer {
  stop(): void;
}

const defaultSetTimer = (run: () => void, ms: number): unknown => {
  const handle = setTimeout(run, ms);
  // The timer alone must not keep the process alive once the server has closed.
  handle.unref();
  return handle;
};

const defaultClearTimer = (handle: unknown): void => {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
};

/** Starts a refresh every `everyHours`, one turn at a time, until stopped. */
export function startRefreshTimer(options: TimerOptions): RefreshTimer {
  const setTimer = options.setTimer ?? defaultSetTimer;
  const clearTimer = options.clearTimer ?? defaultClearTimer;
  const interval = options.everyHours * HOUR_MS;
  let stopped = false;
  let handle: unknown = null;

  const wait = (ms: number): void => {
    if (!stopped) handle = setTimer(turn, ms);
  };
  const turn = (): void => {
    options.start().then(
      (started) => wait(started ? interval : REFRESH_RETRY_MS),
      (error: unknown) => {
        options.onProblem?.(error instanceof Error ? error.message : String(error));
        wait(interval);
      },
    );
  };
  wait(FIRST_REFRESH_DELAY_MS);

  return {
    stop() {
      stopped = true;
      clearTimer(handle);
    },
  };
}

/**
 * A `start` for the timer that goes through the API's own route, so the timer
 * and the "Refresh now" button share one path and one job at a time. It
 * answers false when the route refuses because a map or a refresh is running.
 */
export function startThroughApi(
  app: (request: Request) => Promise<Response>,
  host: string,
): () => Promise<boolean> {
  return async () => {
    const reply = await app(
      new Request(`http://${host}/api/refresh`, {
        method: 'POST',
        headers: { host, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    if (reply.status === 202) return true;
    if (reply.status === 409) return false;
    throw new Error(`The refresh could not be started (${reply.status})`);
  };
}

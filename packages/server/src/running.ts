/**
 * Keeps track of the work an engine has under way, so that closing it can
 * wait for that work instead of pulling the store out from under it.
 */

export const CLOSING = 'Jgtube is closing, so no new work is started.';

export interface WorkTracker {
  /** Starts work and remembers it until it ends. Rejects, starting nothing, once closing has begun. */
  run<T>(work: () => Promise<T>): Promise<T>;
  /** Whether closing has begun. */
  isClosing(): boolean;
  /**
   * Refuses new work from now on and waits for the work under way to end, for
   * at most `graceMs`. Resolves either way; it never rejects.
   */
  windDown(graceMs: number): Promise<void>;
}

export function trackWork(): WorkTracker {
  let under: ReadonlySet<Promise<void>> = new Set();
  let closing = false;

  const remember = (ended: Promise<void>): void => {
    under = new Set([...under, ended]);
    void ended.then(() => {
      under = new Set([...under].filter((other) => other !== ended));
    });
  };

  return {
    isClosing: () => closing,

    run(work) {
      if (closing) return Promise.reject(new Error(CLOSING));
      const outcome = work();
      remember(
        outcome.then(
          () => {},
          () => {},
        ),
      );
      return outcome;
    },

    async windDown(graceMs) {
      closing = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const patience = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, graceMs);
      });
      await Promise.race([Promise.all(under), patience]);
      clearTimeout(timer);
    },
  };
}

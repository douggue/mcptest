/**
 * What was last found out about the engines, answered at once. Finding out
 * starts each program (several seconds on some computers), so no page waits
 * for it: an old answer is given straight away and checked again in the
 * background. Only when nothing has ever been found out, or a new check is
 * asked for (Settings, "Check again"), does a caller wait.
 */

export interface Found<T> {
  /** When it was found out, in milliseconds since 1970. */
  readonly at: number;
  readonly value: T;
}

export interface LastKnownOptions<T> {
  /** Finds out afresh. A failure is never remembered: the next call asks again. */
  readonly load: () => Promise<T>;
  /** How long an answer is fresh; an older one is still given, and checked again behind it. */
  readonly freshMs: number;
  /** What a run before this one found out, if it was kept; null when there is none. */
  readonly read?: () => Found<T> | null;
  /** Keeps what was found out for the next run. */
  readonly write?: (found: Found<T>) => void;
  /** No check starts in the background before this time: the first page load has the computer. */
  readonly quietUntil?: number;
  readonly now?: () => number;
  /** Waits before a background check; replaced in tests. */
  readonly later?: (run: () => void, ms: number) => void;
}

export type LastKnown<T> = (fresh?: boolean) => Promise<T>;

export function lastKnown<T>(options: LastKnownOptions<T>): LastKnown<T> {
  const now = options.now ?? (() => Date.now());
  const later = options.later ?? ((run, ms) => void setTimeout(run, ms).unref());
  let kept: Found<T> | null = null;
  let readStored = false;
  let checking: Promise<T> | null = null;
  let waiting = false;

  const check = (): Promise<T> => {
    if (checking) return checking;
    const attempt = options.load().then((value) => {
      kept = { at: now(), value };
      try {
        options.write?.(kept);
      } catch {
        // Not keeping it for the next run changes nothing in this one.
      }
      return value;
    });
    checking = attempt;
    attempt.then(
      () => (checking = null),
      () => (checking = null),
    );
    return attempt;
  };

  const checkBehind = (): void => {
    if (checking || waiting) return;
    waiting = true;
    later(
      () => {
        waiting = false;
        check().catch(() => {
          // The old answer stays; the next call tries again.
        });
      },
      Math.max(0, (options.quietUntil ?? 0) - now()),
    );
  };

  const stored = (): Found<T> | null => {
    if (!readStored) {
      readStored = true;
      try {
        kept ??= options.read?.() ?? null;
      } catch {
        // An unreadable file counts as nothing found out.
      }
    }
    return kept;
  };

  return (fresh = false) => {
    if (fresh) return check();
    const found = stored();
    if (found === null) return check();
    if (now() - found.at > options.freshMs) checkBehind();
    return Promise.resolve(found.value);
  };
}

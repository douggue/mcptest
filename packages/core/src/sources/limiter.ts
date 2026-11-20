export interface RateLimiterOptions {
  /** Maximum number of tasks running at once. */
  readonly concurrency: number;
  /** Each attempt waits a random time between these two bounds first. */
  readonly minDelayMs: number;
  readonly maxDelayMs: number;
  /** Extra attempts allowed after a transient failure. */
  readonly maxRetries: number;
  /** First backoff; doubles on each further retry. */
  readonly baseBackoffMs: number;
  /** Gives up on an attempt that takes longer than this, so a hung request cannot hold a slot. */
  readonly taskTimeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly isRetryable?: (error: unknown) => boolean;
}

const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_MESSAGE =
  /\bstatus(?:\s+code)?\s*:?\s*(?:408|429|5\d\d)\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|timed out/i;

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as Record<string, unknown>;
  const status = record['status'] ?? record['statusCode'];
  return typeof status === 'number' ? status : null;
}

/** True for failures worth retrying: rate limits, server errors, dropped connections, timeouts. */
export function isTransientError(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== null) return TRANSIENT_STATUSES.has(status);
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_MESSAGE.test(message);
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Keeps outbound requests polite: a concurrency cap, a jittered delay before
 * every attempt, and exponential backoff when the remote side pushes back.
 */
export class RateLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly isRetryable: (error: unknown) => boolean;

  constructor(private readonly options: RateLimiterOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new RangeError('concurrency must be a whole number of at least 1');
    }
    this.sleep = options.sleep ?? realSleep;
    this.random = options.random ?? Math.random;
    this.isRetryable = options.isRetryable ?? isTransientError;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await this.attempt(task);
    } finally {
      this.release();
    }
  }

  private async attempt<T>(task: () => Promise<T>): Promise<T> {
    for (let retry = 0; ; retry += 1) {
      await this.sleep(this.jitter());
      try {
        return await this.withTimeout(task);
      } catch (error) {
        if (retry >= this.options.maxRetries || !this.isRetryable(error)) throw error;
        await this.sleep(this.options.baseBackoffMs * 2 ** retry);
      }
    }
  }

  private withTimeout<T>(task: () => Promise<T>): Promise<T> {
    const { taskTimeoutMs } = this.options;
    if (taskTimeoutMs === undefined) return task();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timed out after ${taskTimeoutMs} ms`));
      }, taskTimeoutMs);
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          clearTimeout(timer);
        });
    });
  }

  private jitter(): number {
    const { minDelayMs, maxDelayMs } = this.options;
    return minDelayMs + this.random() * (maxDelayMs - minDelayMs);
  }

  private acquire(): Promise<void> {
    if (this.active < this.options.concurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /** Hands the slot straight to the next waiter, or frees it. */
  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.active -= 1;
    }
  }
}

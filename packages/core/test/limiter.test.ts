import { describe, expect, test } from 'vitest';
import { RateLimiter } from '../src/sources/limiter';

function makeLimiter(overrides: Partial<ConstructorParameters<typeof RateLimiter>[0]> = {}) {
  const sleeps: number[] = [];
  const limiter = new RateLimiter({
    concurrency: 2,
    minDelayMs: 300,
    maxDelayMs: 600,
    maxRetries: 3,
    baseBackoffMs: 1000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    ...overrides,
  });
  return { limiter, sleeps };
}

describe('RateLimiter', () => {
  test('returns the task result after a jittered delay', async () => {
    const { limiter, sleeps } = makeLimiter();

    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
    expect(sleeps).toEqual([450]);
  });

  test('never runs more tasks at once than the concurrency limit', async () => {
    const { limiter } = makeLimiter({ concurrency: 2 });
    let inFlight = 0;
    let peak = 0;
    const task = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    };

    await Promise.all(Array.from({ length: 6 }, () => limiter.run(task)));

    expect(peak).toBe(2);
  });

  test('retries a rate-limited task with exponential backoff', async () => {
    const { limiter, sleeps } = makeLimiter();
    let attempts = 0;

    const result = await limiter.run(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('Request failed with status 429');
      return attempts;
    });

    expect(result).toBe(3);
    expect(sleeps).toEqual([450, 1000, 450, 2000, 450]);
  });

  test('gives up after the retry limit and rethrows the last error', async () => {
    const { limiter } = makeLimiter({ maxRetries: 2 });
    let attempts = 0;

    await expect(
      limiter.run(async () => {
        attempts += 1;
        throw new Error('status 503');
      }),
    ).rejects.toThrow('status 503');
    expect(attempts).toBe(3);
  });

  test('does not retry errors that are not transient', async () => {
    const { limiter } = makeLimiter();
    let attempts = 0;

    await expect(
      limiter.run(async () => {
        attempts += 1;
        throw new Error('This channel does not exist');
      }),
    ).rejects.toThrow('does not exist');
    expect(attempts).toBe(1);
  });

  test('releases its slot after a failure so later tasks still run', async () => {
    const { limiter } = makeLimiter({ concurrency: 1 });

    await expect(
      limiter.run(async () => {
        throw new Error('permanent');
      }),
    ).rejects.toThrow();
    await expect(limiter.run(async () => 'next')).resolves.toBe('next');
  });
});

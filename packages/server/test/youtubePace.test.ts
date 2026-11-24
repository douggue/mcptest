import { RateLimiter, type RateLimiterOptions, type YouTubeSource } from '@jgtube/core';
import { afterEach, describe, expect, test } from 'vitest';
import { YOUTUBE_PACE, youtubeSource } from '../src/connection';

const PROXY_NAME = 'JGTUBE_YOUTUBE_PROXY';
const before = process.env[PROXY_NAME];

afterEach(() => {
  if (before === undefined) delete process.env[PROXY_NAME];
  else process.env[PROXY_NAME] = before;
});

const fakeSource = {} as YouTubeSource;

/** The pace the connection to YouTube is made with, and the options it is created with. */
async function connectWith(proxy: string | undefined) {
  if (proxy === undefined) delete process.env[PROXY_NAME];
  else process.env[PROXY_NAME] = proxy;
  const paces: RateLimiterOptions[] = [];
  const created: Array<{ readonly region: string }> = [];
  await youtubeSource(
    { dbPath: ':memory:', region: 'US' },
    {
      makeLimiter: (options) => {
        paces.push(options);
        return new RateLimiter(options);
      },
      create: async (options) => {
        created.push({ region: options.region });
        return fakeSource;
      },
    },
  );
  return { paces, created };
}

describe('the pace YouTube is read at', () => {
  test('is two at a time, 300 to 600 ms apart, with the same retries as before', () => {
    expect(YOUTUBE_PACE).toEqual({
      concurrency: 2,
      minDelayMs: 300,
      maxDelayMs: 600,
      maxRetries: 3,
      baseBackoffMs: 2000,
      taskTimeoutMs: 30_000,
    });
  });

  test('is exactly the same with a proxy set as without one', async () => {
    const without = await connectWith(undefined);
    const withHttp = await connectWith('http://user:pass@gate.example.net:8080');
    const withSocks = await connectWith('socks5://gate.example.net:1080');
    expect(without.paces).toEqual([YOUTUBE_PACE]);
    expect(withHttp.paces).toEqual(without.paces);
    expect(withSocks.paces).toEqual(without.paces);
    expect(withHttp.created).toEqual(without.created);
  });
});

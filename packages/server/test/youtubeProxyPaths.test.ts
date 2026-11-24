import { InnertubeSource, RateLimiter, fetchThumbnail } from '@jgtube/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { startHttpProxy, type LocalServer } from '../../core/test/localProxies';
import { settingsStore } from '../src/settingsStore';

/**
 * The real paths to YouTube, with the proxy saved from the settings screen
 * while Jgtube runs. The proxy here only notes where it was asked to go and
 * refuses, so nothing leaves this computer.
 */

const NAME = 'JGTUBE_YOUTUBE_PROXY';
const before = process.env[NAME];
let folder: string;
let proxy: LocalServer;

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-proxy-paths-'));
  proxy = await startHttpProxy(undefined, true);
  const saved = settingsStore({
    envPath: join(folder, '.env'),
    env: process.env,
    outside: new Set(),
  }).save({ [NAME]: `http://127.0.0.1:${proxy.port}` });
  expect(saved.ok).toBe(true);
});

afterEach(async () => {
  if (before === undefined) delete process.env[NAME];
  else process.env[NAME] = before;
  await proxy.close();
  rmSync(folder, { recursive: true, force: true });
});

describe('with a proxy for YouTube saved', () => {
  test('a thumbnail is asked for through it', async () => {
    const result = await fetchThumbnail('jNQXAC9IVRw');
    expect(result.ok).toBe(false);
    expect(proxy.seen).toEqual(['i.ytimg.com:443']);
  });

  test('the YouTube library and the watch page read go through it', async () => {
    const limiter = new RateLimiter({
      concurrency: 1,
      minDelayMs: 0,
      maxDelayMs: 0,
      maxRetries: 0,
      baseBackoffMs: 0,
    });
    // The library starts without its session data when it cannot fetch it; a read then fails.
    const source = await InnertubeSource.create({ region: 'US', limiter });
    await expect(source.fetchChannel('UCHnyfMqiRRG1u-2MsSQLbXA', 0)).rejects.toThrow(
      /through the proxy for YouTube/,
    );
    await expect(source.fetchWatchHtml('jNQXAC9IVRw')).rejects.toThrow(
      /through the proxy for YouTube/,
    );
    expect(proxy.seen.length).toBeGreaterThan(0);
    expect(proxy.seen.every((host) => host === 'www.youtube.com:443')).toBe(true);
  });
});

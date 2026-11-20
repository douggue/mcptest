import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { DEFAULT_DEPTH, DEFAULT_MAX_CHANNELS, MAX_DEPTH } from '../src/crawl/crawl';
import {
  CRAWL_DEFAULT_DEPTH,
  CRAWL_DEFAULT_MAX_CHANNELS,
  CRAWL_MAX_CHANNELS_ASKED,
  CRAWL_MAX_DEPTH,
  CRAWL_MIN_CHANNELS_ASKED,
  REFRESH_DEFAULT_MAX_CHANNELS,
  REFRESH_MAX_CHANNELS,
  SMALL_CHANNEL_MAX_SUBSCRIBERS,
} from '../src/limits';
import { NICHE_SMALL_MAX_SUBSCRIBERS } from '../src/niches/niches';
import { DEFAULT_REFRESH_MAX_CHANNELS, MAX_REFRESH_CHANNELS } from '../src/refresh/refresh';

describe('the limits every part of Jgtube shares', () => {
  test('are the ones the crawl, the refresh and the niche list work by', () => {
    expect([DEFAULT_DEPTH, MAX_DEPTH, DEFAULT_MAX_CHANNELS]).toEqual([
      CRAWL_DEFAULT_DEPTH,
      CRAWL_MAX_DEPTH,
      CRAWL_DEFAULT_MAX_CHANNELS,
    ]);
    expect([DEFAULT_REFRESH_MAX_CHANNELS, MAX_REFRESH_CHANNELS]).toEqual([
      REFRESH_DEFAULT_MAX_CHANNELS,
      REFRESH_MAX_CHANNELS,
    ]);
    expect(NICHE_SMALL_MAX_SUBSCRIBERS).toBe(SMALL_CHANNEL_MAX_SUBSCRIBERS);
  });

  test('keep the values the owner has been working with', () => {
    expect({
      CRAWL_DEFAULT_DEPTH,
      CRAWL_MAX_DEPTH,
      CRAWL_DEFAULT_MAX_CHANNELS,
      CRAWL_MIN_CHANNELS_ASKED,
      CRAWL_MAX_CHANNELS_ASKED,
      REFRESH_DEFAULT_MAX_CHANNELS,
      REFRESH_MAX_CHANNELS,
      SMALL_CHANNEL_MAX_SUBSCRIBERS,
    }).toEqual({
      CRAWL_DEFAULT_DEPTH: 2,
      CRAWL_MAX_DEPTH: 3,
      CRAWL_DEFAULT_MAX_CHANNELS: 150,
      CRAWL_MIN_CHANNELS_ASKED: 10,
      CRAWL_MAX_CHANNELS_ASKED: 600,
      REFRESH_DEFAULT_MAX_CHANNELS: 50,
      REFRESH_MAX_CHANNELS: 500,
      SMALL_CHANNEL_MAX_SUBSCRIBERS: 10_000,
    });
  });

  test('live in a file that imports nothing, so the web app can use it without the store', () => {
    const text = readFileSync(fileURLToPath(new URL('../src/limits.ts', import.meta.url)), 'utf8');

    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).not.toMatch(/\brequire\(/);
  });
});

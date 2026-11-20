import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DEFAULT_DAILY_UNITS, DEFAULT_REGIONS, loadConfig } from '../src/config';

const KEY = 'test-key-not-a-real-one-0123456789';
/** The project folder: the one that holds `src` and `test`. */
const PROJECT = resolve(import.meta.dirname, '..');

describe('loadConfig', () => {
  test('fills in the defaults when only the key is set', () => {
    const config = loadConfig({ YOUTUBE_API_KEY: KEY });

    expect(config).toEqual({
      dbPath: resolve(PROJECT, 'shorts-finder.db'),
      youtubeApiKey: KEY,
      regions: ['US', 'GB', 'CA', 'AU'],
      language: 'en',
      dailyUnits: 10_000,
      shortsRate: { low: 0.1, high: 0.5 },
    });
    expect(DEFAULT_REGIONS).toEqual(config.regions);
    expect(DEFAULT_DAILY_UNITS).toBe(config.dailyUnits);
  });

  test('reads every setting from the environment', () => {
    const config = loadConfig({
      SHORTS_DB_PATH: '/var/lib/shorts/store.db',
      YOUTUBE_API_KEY: KEY,
      SHORTS_REGIONS: 'DE,NZ',
      SHORTS_LANGUAGE: 'de',
      SHORTS_DAILY_UNITS: '50000',
      SHORTS_RATE_LOW: '0.05',
      SHORTS_RATE_HIGH: '0.3',
    });

    expect(config).toEqual({
      dbPath: '/var/lib/shorts/store.db',
      youtubeApiKey: KEY,
      regions: ['DE', 'NZ'],
      language: 'de',
      dailyUnits: 50_000,
      shortsRate: { low: 0.05, high: 0.3 },
    });
  });

  test('accepts regions in any case with spaces, and lists each once', () => {
    const config = loadConfig({ YOUTUBE_API_KEY: KEY, SHORTS_REGIONS: ' us, ie ,US ' });

    expect(config.regions).toEqual(['US', 'IE']);
  });

  test.each([
    ['SHORTS_REGIONS', 'USA,GB'],
    ['SHORTS_REGIONS', ''],
    ['SHORTS_REGIONS', 'US,,GB'],
    ['SHORTS_LANGUAGE', 'english'],
    ['SHORTS_DAILY_UNITS', 'lots'],
    ['SHORTS_DAILY_UNITS', '0'],
    ['SHORTS_DAILY_UNITS', '12.5'],
    ['SHORTS_DB_PATH', ''],
    ['SHORTS_RATE_LOW', 'cheap'],
    ['SHORTS_RATE_LOW', '-0.1'],
    ['SHORTS_RATE_HIGH', '500'],
    ['SHORTS_RATE_LOW', '0.9'],
  ])('fails fast naming %s when it is "%s"', (name, value) => {
    expect(() => loadConfig({ YOUTUBE_API_KEY: KEY, [name]: value })).toThrow(
      new RegExp(`Invalid configuration\\. .*${name}`),
    );
  });

  test('takes a relative store path from the project folder, wherever the program was started', () => {
    const config = loadConfig({ YOUTUBE_API_KEY: KEY, SHORTS_DB_PATH: 'data/store.db' });

    expect(config.dbPath).toBe(resolve(PROJECT, 'data/store.db'));
    expect(config.dbPath).not.toBe(resolve(process.cwd(), '..', 'data/store.db'));
  });

  test('leaves a store that lives only in memory as it is', () => {
    expect(loadConfig({ YOUTUBE_API_KEY: KEY, SHORTS_DB_PATH: ':memory:' }).dbPath).toBe(
      ':memory:',
    );
  });

  test('says the key is missing when none is set', () => {
    expect(() => loadConfig({})).toThrow(/YOUTUBE_API_KEY: is missing/);
  });

  test('never repeats a badly shaped key in the message', () => {
    const shortKey = 'too-short-key';
    let message = '';

    try {
      loadConfig({ YOUTUBE_API_KEY: shortKey });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/YOUTUBE_API_KEY/);
    expect(message).not.toContain(shortKey);
  });

  test('names every bad variable at once', () => {
    expect(() =>
      loadConfig({ YOUTUBE_API_KEY: KEY, SHORTS_REGIONS: 'X', SHORTS_LANGUAGE: '1' }),
    ).toThrow(/SHORTS_REGIONS.*SHORTS_LANGUAGE/);
  });
});

import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  ConfigError,
  DEFAULT_DAILY_UNITS,
  DEFAULT_REGIONS,
  loadConfig,
  loadStoreConfig,
} from '../src/config';

const KEY = 'test-key-not-a-real-one-0123456789';
/** Shaped like a bot token and plainly not one. */
const BOT_TOKEN = '1234567890:TEST-token-not-a-real-one-0123456789';
const CHAT_ID = '-1001234567890';
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
      telegram: null,
      maxAlertsPerDay: 10,
      digestHour: 18,
      timeZone: 'UTC',
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
      TELEGRAM_BOT_TOKEN: BOT_TOKEN,
      TELEGRAM_CHAT_ID: CHAT_ID,
      SHORTS_MAX_ALERTS_PER_DAY: '4',
      SHORTS_DIGEST_HOUR: '7',
      SHORTS_TIMEZONE: 'Australia/Sydney',
    });

    expect(config).toEqual({
      dbPath: '/var/lib/shorts/store.db',
      youtubeApiKey: KEY,
      regions: ['DE', 'NZ'],
      language: 'de',
      dailyUnits: 50_000,
      shortsRate: { low: 0.05, high: 0.3 },
      telegram: { botToken: BOT_TOKEN, chatId: CHAT_ID },
      maxAlertsPerDay: 4,
      digestHour: 7,
      timeZone: 'Australia/Sydney',
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
    ['SHORTS_MAX_ALERTS_PER_DAY', '0'],
    ['SHORTS_MAX_ALERTS_PER_DAY', '101'],
    ['SHORTS_MAX_ALERTS_PER_DAY', 'ten'],
    ['SHORTS_DIGEST_HOUR', '24'],
    ['SHORTS_DIGEST_HOUR', '6pm'],
    ['SHORTS_TIMEZONE', 'Mars/Olympus'],
    ['SHORTS_TIMEZONE', ''],
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

  test('turns alerts off when neither Telegram setting is given, or both are left empty', () => {
    expect(loadConfig({ YOUTUBE_API_KEY: KEY }).telegram).toBeNull();
    expect(
      loadConfig({ YOUTUBE_API_KEY: KEY, TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' }).telegram,
    ).toBeNull();
  });

  test('fails fast naming the Telegram setting that is missing when only one is given', () => {
    expect(() => loadConfig({ YOUTUBE_API_KEY: KEY, TELEGRAM_BOT_TOKEN: BOT_TOKEN })).toThrow(
      'Invalid configuration. TELEGRAM_CHAT_ID: is missing, though TELEGRAM_BOT_TOKEN is set',
    );
    expect(() => loadConfig({ YOUTUBE_API_KEY: KEY, TELEGRAM_CHAT_ID: CHAT_ID })).toThrow(
      'Invalid configuration. TELEGRAM_BOT_TOKEN: is missing, though TELEGRAM_CHAT_ID is set',
    );
  });

  test('never repeats a badly shaped token or chat in the message', () => {
    const env = {
      YOUTUBE_API_KEY: KEY,
      TELEGRAM_BOT_TOKEN: 'CHANGE_ME-secret-looking',
      TELEGRAM_CHAT_ID: 'my-private-chat',
    };
    let message = '';

    try {
      loadConfig(env);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/TELEGRAM_BOT_TOKEN: is not shaped like.*TELEGRAM_CHAT_ID: must be/);
    expect(message).not.toContain('secret-looking');
    expect(message).not.toContain('my-private-chat');
  });
});

describe('loadStoreConfig', () => {
  test('needs no key or token, and gives where the store is and how it is used', () => {
    expect(
      loadStoreConfig({ SHORTS_DB_PATH: '/var/lib/shorts/store.db', SHORTS_REGIONS: 'GB' }),
    ).toEqual({
      dbPath: '/var/lib/shorts/store.db',
      regions: ['GB'],
      language: 'en',
      dailyUnits: 10_000,
    });
  });

  test('fails fast naming a bad setting', () => {
    expect(() => loadStoreConfig({ SHORTS_DAILY_UNITS: 'lots' })).toThrow(
      /Invalid configuration\. SHORTS_DAILY_UNITS/,
    );
  });
});

import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  test('uses defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({ dbPath: 'jgtube.db', region: 'US' });
  });

  test('reads overrides from the environment', () => {
    const config = loadConfig({ JGTUBE_DB_PATH: '/data/jgtube.db', JGTUBE_REGION: 'GB' });

    expect(config).toEqual({ dbPath: '/data/jgtube.db', region: 'GB' });
  });

  test('reads the YouTube API key when one is set, and leaves it out otherwise', () => {
    expect(loadConfig({ YOUTUBE_API_KEY: 'a-key-of-plausible-length' }).youtubeApiKey).toBe(
      'a-key-of-plausible-length',
    );
    expect('youtubeApiKey' in loadConfig({})).toBe(false);
  });

  test('rejects an API key too short to be one, without repeating it', () => {
    expect(() => loadConfig({ YOUTUBE_API_KEY: 'abc123' })).toThrow(/YOUTUBE_API_KEY/);
    expect(() => loadConfig({ YOUTUBE_API_KEY: 'abc123' })).not.toThrow(/abc123/);
  });

  test('rejects a region that is not a two-letter code', () => {
    expect(() => loadConfig({ JGTUBE_REGION: 'United States' })).toThrow(/JGTUBE_REGION/);
  });

  test('rejects an empty database path', () => {
    expect(() => loadConfig({ JGTUBE_DB_PATH: '' })).toThrow(/JGTUBE_DB_PATH/);
  });
});

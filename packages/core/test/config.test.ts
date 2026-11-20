import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  test('uses defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({ dbPath: 'scout.db', region: 'US' });
  });

  test('reads overrides from the environment', () => {
    const config = loadConfig({ SCOUT_DB_PATH: '/data/scout.db', SCOUT_REGION: 'GB' });

    expect(config).toEqual({ dbPath: '/data/scout.db', region: 'GB' });
  });

  test('rejects a region that is not a two-letter code', () => {
    expect(() => loadConfig({ SCOUT_REGION: 'United States' })).toThrow(/SCOUT_REGION/);
  });

  test('rejects an empty database path', () => {
    expect(() => loadConfig({ SCOUT_DB_PATH: '' })).toThrow(/SCOUT_DB_PATH/);
  });
});

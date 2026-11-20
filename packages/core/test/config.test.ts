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

  test('rejects a region that is not a two-letter code', () => {
    expect(() => loadConfig({ JGTUBE_REGION: 'United States' })).toThrow(/JGTUBE_REGION/);
  });

  test('rejects an empty database path', () => {
    expect(() => loadConfig({ JGTUBE_DB_PATH: '' })).toThrow(/JGTUBE_DB_PATH/);
  });
});

import { describe, expect, test } from 'vitest';
import {
  changesOf,
  createSettingsApi,
  effectWords,
  hasChanges,
  savedWords,
  stateWords,
  type Drafts,
  type SettingView,
} from '../src/lib/settings';

const FAKE_KEY = 'fake-youtube-key-000000000000';

const setting = (overrides: Partial<SettingView>): SettingView => ({
  name: 'JGTUBE_REGION',
  label: 'Region',
  help: 'The country.',
  secret: false,
  effect: 'restart',
  set: true,
  value: 'US',
  outside: false,
  ...overrides,
});

const key = setting({
  name: 'YOUTUBE_API_KEY',
  label: 'Key',
  secret: true,
  effect: 'now',
  value: null,
});
const region = setting({});

const reply = (status: number, data: unknown, error: string | null = null) =>
  new Response(JSON.stringify({ success: status < 400, data, error, meta: null }), { status });

describe('changesOf', () => {
  test('sends only what was changed', () => {
    const drafts: Drafts = { JGTUBE_REGION: { kind: 'set', value: ' CA ' } };

    expect(changesOf([key, region], drafts)).toEqual({ JGTUBE_REGION: 'CA' });
  });

  test('leaves out a value typed back to what it was, and an empty new key', () => {
    const drafts: Drafts = {
      JGTUBE_REGION: { kind: 'set', value: 'US' },
      YOUTUBE_API_KEY: { kind: 'set', value: '  ' },
    };

    expect(changesOf([key, region], drafts)).toEqual({});
    expect(hasChanges([key, region], drafts)).toBe(false);
  });

  test('clears a setting that was emptied or marked to clear', () => {
    const drafts: Drafts = {
      JGTUBE_REGION: { kind: 'set', value: '' },
      YOUTUBE_API_KEY: { kind: 'clear' },
    };

    expect(changesOf([key, region], drafts)).toEqual({
      JGTUBE_REGION: null,
      YOUTUBE_API_KEY: null,
    });
    expect(hasChanges([key, region], drafts)).toBe(true);
  });

  test('does not clear what was never set', () => {
    const unset = setting({ set: false, value: null });

    expect(changesOf([unset], { JGTUBE_REGION: { kind: 'clear' } })).toEqual({});
    expect(changesOf([unset], { JGTUBE_REGION: { kind: 'set', value: '' } })).toEqual({});
  });

  test('replaces a key with the one typed', () => {
    expect(changesOf([key], { YOUTUBE_API_KEY: { kind: 'set', value: FAKE_KEY } })).toEqual({
      YOUTUBE_API_KEY: FAKE_KEY,
    });
  });
});

describe('the words on the screen', () => {
  test('say whether a key is set, never what it is', () => {
    expect(stateWords(key)).toBe('Set');
    expect(stateWords({ ...key, set: false })).toBe('Not set');
    expect(stateWords({ ...region, set: false, value: null })).toBe('Not set');
    expect(stateWords(region)).toBe('US');
  });

  test('say when a change takes effect', () => {
    expect(effectWords(key)).toBe('Takes effect as soon as you save');
    expect(effectWords(region)).toBe('Takes effect after you restart Jgtube');
    expect(effectWords({ ...region, outside: true })).toMatch(/outside the \.env file/);
  });

  test('say what a save did', () => {
    expect(savedWords([])).toBe('Saved. The changes are in effect now.');
    expect(savedWords(['Region', 'Downloads folder'])).toBe(
      'Saved. Restart Jgtube for these to take effect: Region, Downloads folder.',
    );
  });
});

describe('createSettingsApi', () => {
  test('reads the settings, saves changes with a POST and reads the programs', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const view = { settings: [region], fileFound: true, restart: [] };
    const api = createSettingsApi(async (path, init) => {
      calls.push([path, init]);
      if (path === '/api/settings/programs') return reply(200, { engines: ['a'], helpers: ['b'] });
      if (path === '/api/settings/allow-antigravity') return reply(200, { ok: true, lines: ['c'] });
      return reply(200, view);
    });

    expect(await api.read()).toEqual(view);
    expect(await api.save({ JGTUBE_REGION: 'CA' })).toEqual(view);
    expect(await api.programs()).toEqual({ engines: ['a'], helpers: ['b'] });
    expect(await api.allowAntigravity()).toEqual({ ok: true, lines: ['c'] });
    expect(calls[1]?.[1]?.method).toBe('POST');
    expect(calls[1]?.[1]?.body).toBe(JSON.stringify({ changes: { JGTUBE_REGION: 'CA' } }));
    expect(calls[3]?.[1]?.method).toBe('POST');
  });

  test('passes on the server’s refusal', async () => {
    const api = createSettingsApi(async () => reply(400, null, 'Region: must be two letters'));

    await expect(api.save({ JGTUBE_REGION: 'x' })).rejects.toThrow('Region: must be two letters');
  });
});

import type { ProxyCheck } from '@jgtube/core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { JobStore } from '../src/jobs';
import { SETTINGS } from '../src/settingsCatalog';
import { settingsEngine } from '../src/settingsEngine';
import { PROXY_TEST_PATH, type SettingsEngine } from '../src/settingsRoutes';
import { settingsStore } from '../src/settingsStore';
import { HOST, get, post, read, stubEngine } from './support';

const NAME = 'JGTUBE_YOUTUBE_PROXY';
const PROXY = 'socks5://owner:hunter2@gate.example.net:7000';

let folder: string;
let envPath: string;
let env: Record<string, string | undefined>;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-proxy-setting-'));
  envPath = join(folder, '.env');
  env = {};
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const store = () => settingsStore({ envPath, env, outside: new Set() });

describe('the Proxy for YouTube setting', () => {
  test('is a secret in Advanced that takes effect as soon as it is saved, with plain help', () => {
    const setting = SETTINGS.find((candidate) => candidate.name === NAME);
    expect(setting).toMatchObject({ label: 'Proxy for YouTube', secret: true, effect: 'now' });
    expect(setting?.help).toBe(
      'Sends Jgtube’s YouTube reading and downloads through this address. Use an address in your own country, or your map’s recommendations will be another country’s.',
    );
  });

  test('is saved, put in force at once, and never shown again', () => {
    let reloads = 0;
    const settings = settingsStore({
      envPath,
      env,
      outside: new Set(),
      onSaved: () => {
        reloads += 1;
      },
    });
    const outcome = settings.save({ [NAME]: PROXY });
    expect(outcome.ok).toBe(true);
    expect(env[NAME]).toBe(PROXY);
    expect(reloads).toBe(1);
    expect(readFileSync(envPath, 'utf8')).toContain(PROXY);
    const view = settings.view().settings.find((setting) => setting.name === NAME);
    expect(view).toMatchObject({ set: true, value: null });
    expect(JSON.stringify(settings.view())).not.toContain('hunter2');
  });

  test('refuses an address that is not a proxy, without repeating it', () => {
    const outcome = store().save({ [NAME]: 'ftp://owner:hunter2@gate.example.net:21' });
    expect(outcome).toEqual({
      ok: false,
      problem: 'Proxy for YouTube: must start with http://, https:// or socks5://',
    });
    expect(env[NAME]).toBeUndefined();
  });

  test('can be cleared', () => {
    const settings = store();
    settings.save({ [NAME]: PROXY });
    expect(settings.save({ [NAME]: null }).ok).toBe(true);
    expect(env[NAME]).toBeUndefined();
  });
});

describe('testing the proxy from the settings screen', () => {
  const engineWith = (check: (proxy: string) => Promise<ProxyCheck>) =>
    settingsEngine({
      store: store(),
      env,
      engineStatus: async () => ({ order: [], engines: [] }),
      checkProxy: check,
    });

  test('says so when no proxy is saved, and makes no request', async () => {
    const asked: string[] = [];
    const result = await engineWith(async (proxy) => {
      asked.push(proxy);
      return { verdict: 'reachable', reason: '' };
    }).testYouTubeProxy();
    expect(result).toEqual({
      verdict: 'not-set',
      reason: 'No proxy is saved yet. Save one, then test it.',
    });
    expect(asked).toEqual([]);
  });

  test('tests the proxy that is saved', async () => {
    env[NAME] = PROXY;
    const asked: string[] = [];
    const result = await engineWith(async (proxy) => {
      asked.push(proxy);
      return { verdict: 'sign-in', reason: 'YouTube asked to sign in.' };
    }).testYouTubeProxy();
    expect(asked).toEqual([PROXY]);
    expect(result).toEqual({ verdict: 'sign-in', reason: 'YouTube asked to sign in.' });
  });

  test('says a saved address that is not valid is not valid', async () => {
    env[NAME] = 'http://owner:hunter2@gate';
    const result = await engineWith(async () => ({
      verdict: 'reachable',
      reason: '',
    })).testYouTubeProxy();
    expect(result.verdict).toBe('refused');
    expect(result.reason).toMatch(/not valid/);
    expect(result.reason).not.toContain('hunter2');
  });
});

describe(`POST ${PROXY_TEST_PATH}`, () => {
  const appWith = (testYouTubeProxy: SettingsEngine['testYouTubeProxy']) =>
    createApp({
      engine: stubEngine({}),
      jobs: new JobStore(),
      allowedHosts: [HOST],
      settings: {
        ...store(),
        programs: async () => ({ engines: [], helpers: [] }),
        allowAntigravity: () => ({ ok: true, lines: [] }),
        testYouTubeProxy,
      },
    });

  test('answers with the verdict and its reason', async () => {
    const app = appWith(async () => ({ verdict: 'refused', reason: 'Nothing answered.' }));
    const response = await post(app, PROXY_TEST_PATH, {});
    expect(response.status).toBe(200);
    expect((await read(response)).data).toEqual({
      verdict: 'refused',
      reason: 'Nothing answered.',
    });
  });

  test('is a POST only', async () => {
    const app = appWith(async () => ({ verdict: 'reachable', reason: '' }));
    expect((await get(app, PROXY_TEST_PATH)).status).toBe(405);
  });
});

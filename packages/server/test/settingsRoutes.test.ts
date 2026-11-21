import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { JobStore } from '../src/jobs';
import type { SettingsEngine } from '../src/settingsRoutes';
import { settingsStore, type SettingsView } from '../src/settingsStore';
import { HOST, get, post, read, stubEngine } from './support';

const PATH = '/api/settings';
const FAKE_KEY = 'fake-youtube-key-000000000000';

let folder: string;
let envPath: string;
let env: Record<string, string | undefined>;

function appWith(parts: Partial<SettingsEngine> = {}) {
  const store = settingsStore({ envPath, env, outside: new Set() });
  const settings: SettingsEngine = {
    ...store,
    programs: async () => ({
      engines: ['AI engines on this computer'],
      helpers: ['yt-dlp: not found'],
    }),
    allowAntigravity: () => ({ ok: true, lines: ['Done.'] }),
    ...parts,
  };
  return createApp({
    engine: stubEngine({}),
    jobs: new JobStore(),
    allowedHosts: [HOST],
    settings,
  });
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-settings-routes-'));
  envPath = join(folder, '.env');
  env = {};
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('GET /api/settings', () => {
  test('lists the settings and never a key’s value', async () => {
    env = { YOUTUBE_API_KEY: FAKE_KEY, JGTUBE_REGION: 'CA' };

    const response = await get(appWith(), PATH);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain(FAKE_KEY);
    const { data } = JSON.parse(text) as { data: SettingsView };
    expect(data.settings.find((setting) => setting.name === 'YOUTUBE_API_KEY')).toMatchObject({
      set: true,
      value: null,
    });
    expect(data.settings.find((setting) => setting.name === 'JGTUBE_REGION')?.value).toBe('CA');
  });

  test('answers only to its own address', async () => {
    expect((await get(appWith(), PATH, 'evil.example')).status).toBe(403);
  });
});

describe('POST /api/settings', () => {
  test('saves a change and answers with the settings, the key’s value left out', async () => {
    writeFileSync(envPath, '# mine\n');

    const response = await post(appWith(), PATH, { changes: { YOUTUBE_API_KEY: FAKE_KEY } });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain(FAKE_KEY);
    expect(readFileSync(envPath, 'utf8')).toBe(`# mine\nYOUTUBE_API_KEY=${FAKE_KEY}\n`);
    expect(env['YOUTUBE_API_KEY']).toBe(FAKE_KEY);
  });

  test('says which changed settings need Jgtube started again', async () => {
    const response = await post(appWith(), PATH, {
      changes: { JGTUBE_REGION: 'CA', JGTUBE_ENGINES: 'claude' },
    });

    expect((await read<{ restart: string[] }>(response)).data.restart).toEqual(['Region']);
  });

  test('refuses a bad value with the setting’s name and never the value', async () => {
    const bad = 'not a key at all, with spaces';

    const response = await post(appWith(), PATH, { changes: { GEMINI_API_KEY: bad } });
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).toContain('Gemini API key');
    expect(text).not.toContain(bad);
  });

  test('refuses a body that is not a list of changes, without repeating it', async () => {
    const response = await post(appWith(), PATH, { changes: { YOUTUBE_API_KEY: 12345 } });
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toContain('12345');
  });

  test.each([
    ['from another site', { origin: 'https://elsewhere.example' }, 403],
    ['not sent as JSON', { 'content-type': 'text/plain' }, 415],
  ])('is refused when %s', async (_what, headers, status) => {
    const response = await post(appWith(), PATH, { changes: { JGTUBE_REGION: 'CA' } }, headers);

    expect(response.status).toBe(status);
    expect(env).toEqual({});
  });

  test('is not changed by a GET or a PUT', async () => {
    const app = appWith();
    const put = await app(
      new Request(`http://${HOST}${PATH}`, { method: 'PUT', headers: { host: HOST } }),
    );

    expect(put.status).toBe(405);
  });
});

describe('the programs on this computer', () => {
  test('are listed as the engines command prints them', async () => {
    const response = await get(appWith(), '/api/settings/programs');

    expect((await read(response)).data).toEqual({
      engines: ['AI engines on this computer'],
      helpers: ['yt-dlp: not found'],
    });
    expect((await post(appWith(), '/api/settings/programs', {})).status).toBe(405);
  });

  test('says so when they cannot be checked', async () => {
    const app = appWith({ programs: () => Promise.reject(new Error('no such program')) });

    expect((await get(app, '/api/settings/programs')).status).toBe(502);
  });
});

describe('POST /api/settings/allow-antigravity', () => {
  test('does what the command does and answers with its lines', async () => {
    const response = await post(appWith(), '/api/settings/allow-antigravity', {});

    expect((await read(response)).data).toEqual({ ok: true, lines: ['Done.'] });
  });

  test('is a POST, from this site only, and says so when it fails', async () => {
    const path = '/api/settings/allow-antigravity';
    const failing = appWith({
      allowAntigravity: () => {
        throw new Error('disk full');
      },
    });

    expect((await get(appWith(), path)).status).toBe(405);
    expect((await post(appWith(), path, {}, { origin: 'https://elsewhere.example' })).status).toBe(
      403,
    );
    expect((await post(failing, path, {})).status).toBe(500);
  });
});

describe('where there is no settings file to write', () => {
  test('the routes say so', async () => {
    const app = createApp({ engine: stubEngine({}), jobs: new JobStore(), allowedHosts: [HOST] });

    expect((await get(app, PATH)).status).toBe(404);
  });
});

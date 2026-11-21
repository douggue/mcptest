import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createEngine } from '../src/engine';
import { liveSettings } from '../src/liveSettings';
import { SETTINGS } from '../src/settingsCatalog';
import { namesSetOutside, settingsStore, type SettingsStore } from '../src/settingsStore';

const FAKE_YOUTUBE_KEY = 'fake-youtube-key-000000000000';
const FAKE_GEMINI_KEY = 'fake_gemini_key_000000000000';

let folder: string;
let envPath: string;
let env: Record<string, string | undefined>;
let saved: number;

const store = (outside: ReadonlySet<string> = new Set()): SettingsStore =>
  settingsStore({ envPath, env, outside, onSaved: () => (saved += 1) });
const fileText = (): string => readFileSync(envPath, 'utf8');
const settingOf = (view: ReturnType<SettingsStore['view']>, name: string) =>
  view.settings.find((setting) => setting.name === name);

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-settings-'));
  envPath = join(folder, '.env');
  env = {};
  saved = 0;
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('the settings as the page is shown them', () => {
  test('lists every setting, with when a change takes effect', () => {
    const view = store().view();

    expect(view.settings.map((setting) => setting.name)).toEqual([
      'YOUTUBE_API_KEY',
      'GEMINI_API_KEY',
      'JGTUBE_ENGINES',
      'JGTUBE_AGY_MODEL',
      'JGTUBE_MARK_FACTS',
      'JGTUBE_YT_DLP_PATH',
      'JGTUBE_FFMPEG_PATH',
      'JGTUBE_DOWNLOADS_PATH',
      'JGTUBE_REFRESH_HOURS',
      'JGTUBE_REGION',
    ]);
    expect(view.fileFound).toBe(false);
    expect(settingOf(view, 'YOUTUBE_API_KEY')).toMatchObject({ effect: 'now', set: false });
    expect(settingOf(view, 'JGTUBE_REGION')).toMatchObject({ effect: 'restart', set: false });
  });

  test('never carries the value of a key, only whether one is set', () => {
    env = {
      YOUTUBE_API_KEY: FAKE_YOUTUBE_KEY,
      GEMINI_API_KEY: FAKE_GEMINI_KEY,
      JGTUBE_REGION: 'CA',
    };

    const view = store().view();

    expect(JSON.stringify(view)).not.toContain(FAKE_YOUTUBE_KEY);
    expect(JSON.stringify(view)).not.toContain(FAKE_GEMINI_KEY);
    expect(settingOf(view, 'YOUTUBE_API_KEY')).toMatchObject({
      secret: true,
      set: true,
      value: null,
    });
    expect(settingOf(view, 'JGTUBE_REGION')).toMatchObject({
      secret: false,
      set: true,
      value: 'CA',
    });
  });
});

describe('saving settings', () => {
  test('writes the file, keeps its other lines, and puts the change in force', () => {
    writeFileSync(envPath, '# mine\nJGTUBE_REGION=US\nUNRELATED=stays\n');
    env = { JGTUBE_REGION: 'US' };

    const outcome = store().save({ JGTUBE_REGION: 'CA', YOUTUBE_API_KEY: FAKE_YOUTUBE_KEY });

    expect(outcome.ok).toBe(true);
    expect(fileText()).toBe(
      `# mine\nJGTUBE_REGION=CA\nUNRELATED=stays\nYOUTUBE_API_KEY=${FAKE_YOUTUBE_KEY}\n`,
    );
    expect(env).toEqual({ JGTUBE_REGION: 'CA', YOUTUBE_API_KEY: FAKE_YOUTUBE_KEY });
    expect(saved).toBe(1);
    expect(outcome.ok && outcome.restart).toEqual(['Region']);
    expect(JSON.stringify(outcome)).not.toContain(FAKE_YOUTUBE_KEY);
  });

  test('keeps one backup of the file as it was, and leaves no temporary file', () => {
    writeFileSync(envPath, 'JGTUBE_REGION=US\n');

    store().save({ JGTUBE_REGION: 'CA' });
    store().save({ JGTUBE_REGION: 'GB' });

    expect(readFileSync(`${envPath}.backup`, 'utf8')).toBe('JGTUBE_REGION=CA\n');
    expect(readdirSync(folder).sort()).toEqual(['.env', '.env.backup']);
  });

  test('makes the file when there is none', () => {
    const outcome = store().save({ JGTUBE_ENGINES: 'claude' });

    expect(outcome.ok).toBe(true);
    expect(fileText()).toBe('JGTUBE_ENGINES=claude\n');
    expect(readdirSync(folder)).toEqual(['.env']);
  });

  test('clears a setting with an empty value or null', () => {
    writeFileSync(envPath, `YOUTUBE_API_KEY=${FAKE_YOUTUBE_KEY}\nJGTUBE_REGION=CA\n`);
    env = { YOUTUBE_API_KEY: FAKE_YOUTUBE_KEY, JGTUBE_REGION: 'CA' };

    const outcome = store().save({ YOUTUBE_API_KEY: null, JGTUBE_REGION: '  ' });

    expect(outcome.ok).toBe(true);
    expect(fileText()).toBe('');
    expect(env).toEqual({});
  });

  test.each([
    ['YOUTUBE_API_KEY', 'short', /YouTube Data API key/],
    ['GEMINI_API_KEY', 'has spaces in it, which no key has', /Gemini API key/],
    ['JGTUBE_ENGINES', 'claude,claude', /AI engines/],
    ['JGTUBE_ENGINES', 'claude,other', /AI engines/],
    ['JGTUBE_AGY_MODEL', '--flag', /Antigravity model/],
    ['JGTUBE_YT_DLP_PATH', 'yt-dlp.exe', /yt-dlp/],
    ['JGTUBE_REFRESH_HOURS', '500', /Refresh/],
    ['JGTUBE_REGION', 'usa', /Region/],
    ['JGTUBE_MARK_FACTS', 'maybe', /Mark facts/],
  ])('refuses a bad %s with the setting’s name and not its value', (name, value, named) => {
    writeFileSync(envPath, 'JGTUBE_REGION=US\n');

    const outcome = store().save({ [name]: value });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.problem).toMatch(named);
    expect(JSON.stringify(outcome)).not.toContain(value);
    expect(fileText()).toBe('JGTUBE_REGION=US\n');
    expect(saved).toBe(0);
  });

  test('refuses a name that is not a setting, and an empty change', () => {
    expect(store().save({ JGTUBE_DB_PATH: 'elsewhere.db' }).ok).toBe(false);
    expect(store().save({}).ok).toBe(false);
  });

  test('accepts a Windows path for a helper program on any computer', () => {
    const outcome = store().save({ JGTUBE_FFMPEG_PATH: 'C:\\Tools\\new ffmpeg\\ffmpeg.exe' });

    expect(outcome.ok).toBe(true);
    expect(env['JGTUBE_FFMPEG_PATH']).toBe('C:\\Tools\\new ffmpeg\\ffmpeg.exe');
  });

  test('says so when the file cannot be written, without the path', () => {
    envPath = join(folder, 'no-such-folder', '.env');

    const outcome = store().save({ JGTUBE_REGION: 'CA' });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.problem).toMatch(/could not be written/);
    expect(JSON.stringify(outcome)).not.toContain(folder);
    expect(env).toEqual({});
  });

  test('a setting given from outside the file is written but stays as it was started', () => {
    env = { JGTUBE_REGION: 'US' };

    const outcome = store(new Set(['JGTUBE_REGION'])).save({ JGTUBE_REGION: 'CA' });

    expect(fileText()).toBe('JGTUBE_REGION=CA\n');
    expect(env['JGTUBE_REGION']).toBe('US');
    expect(outcome.ok && settingOf(outcome.view, 'JGTUBE_REGION')).toMatchObject({
      outside: true,
      value: 'US',
    });
  });
});

describe('namesSetOutside', () => {
  test('names the settings the environment held before the file was read', () => {
    const before = { JGTUBE_REGION: 'US', PATH: '/bin', YOUTUBE_API_KEY: '' };

    expect([...namesSetOutside(before)]).toEqual(['JGTUBE_REGION']);
  });
});

describe('settings that take effect at once', () => {
  test('are marked as such in the catalogue', () => {
    const now = SETTINGS.filter((setting) => setting.effect === 'now').map((s) => s.name);

    expect(now).toEqual([
      'YOUTUBE_API_KEY',
      'GEMINI_API_KEY',
      'JGTUBE_ENGINES',
      'JGTUBE_MARK_FACTS',
      'JGTUBE_YT_DLP_PATH',
      'JGTUBE_FFMPEG_PATH',
    ]);
  });

  test('a key and an engine order saved while Jgtube runs reach the running engine', async () => {
    env = { JGTUBE_DB_PATH: ':memory:' };
    const live = liveSettings(env);
    const engine = createEngine(live.config, {
      engines: live.engines,
      checkEngines: async () => [],
    });
    const settings = settingsStore({ envPath, env, outside: new Set(), onSaved: live.reload });
    expect(engine.canDiscover()).toBe(false);
    expect((await engine.engineStatus()).order).toEqual(['claude', 'agy', 'codex']);

    settings.save({
      YOUTUBE_API_KEY: FAKE_YOUTUBE_KEY,
      GEMINI_API_KEY: FAKE_GEMINI_KEY,
      JGTUBE_ENGINES: 'codex,claude',
      JGTUBE_MARK_FACTS: 'off',
    });

    expect(live.config.markFacts).toBe(false);

    expect(live.config.youtubeApiKey).toBe(FAKE_YOUTUBE_KEY);
    expect(live.engines.gemini?.apiKey).toBe(FAKE_GEMINI_KEY);
    expect((await engine.engineStatus()).order).toEqual(['codex', 'claude']);
    settings.save({ YOUTUBE_API_KEY: null });
    expect(live.config.youtubeApiKey).toBeUndefined();
    engine.close();
  });

  test('a setting that needs a restart stays as it was started', () => {
    env = { JGTUBE_REGION: 'US' };
    const live = liveSettings(env);

    settingsStore({ envPath, env, outside: new Set(), onSaved: live.reload }).save({
      JGTUBE_REGION: 'CA',
      JGTUBE_REFRESH_HOURS: '6',
    });

    expect(live.config.region).toBe('US');
    expect(live.config.refreshHours).toBeUndefined();
  });
});

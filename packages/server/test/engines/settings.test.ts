import { describe, expect, test } from 'vitest';
import { DEFAULT_ENGINE_SETTINGS, loadEngineSettings } from '../../src/engines/settings';

const KEY = 'AIzaSyD-stand-in-key-0123456789abcdef';

describe('loadEngineSettings', () => {
  test('prefers Antigravity, then Claude, then Codex, with nothing else set', () => {
    expect(loadEngineSettings({})).toEqual({
      order: ['agy', 'claude', 'codex'],
      agyYouTubeLinks: false,
    });
    expect(loadEngineSettings({})).toEqual(DEFAULT_ENGINE_SETTINGS);
  });

  test('takes the order from JGTUBE_ENGINES, forgiving spaces and capitals', () => {
    expect(loadEngineSettings({ JGTUBE_ENGINES: ' Claude , codex ' }).order).toEqual([
      'claude',
      'codex',
    ]);
    expect(loadEngineSettings({ JGTUBE_ENGINES: 'codex' }).order).toEqual(['codex']);
  });

  test.each(['claude,gemini', 'claude,,codex', 'claude,claude', ',', 'all'])(
    'refuses JGTUBE_ENGINES=%s, naming the setting',
    (value) => {
      expect(() => loadEngineSettings({ JGTUBE_ENGINES: value })).toThrow(/JGTUBE_ENGINES/);
    },
  );

  test('treats a setting left empty as not set', () => {
    expect(
      loadEngineSettings({ JGTUBE_ENGINES: '', GEMINI_API_KEY: '  ', JGTUBE_AGY_MODEL: '' }),
    ).toEqual(DEFAULT_ENGINE_SETTINGS);
  });

  test('reads the Gemini key and uses Google’s example model unless one is named', () => {
    expect(loadEngineSettings({ GEMINI_API_KEY: KEY }).gemini).toEqual({
      apiKey: KEY,
      model: 'gemini-4-hydrogen',
    });
    expect(
      loadEngineSettings({ GEMINI_API_KEY: KEY, JGTUBE_GEMINI_MODEL: 'gemini-3.8-flash' }).gemini,
    ).toEqual({ apiKey: KEY, model: 'gemini-3.8-flash' });
  });

  test('ignores a Gemini model when there is no key', () => {
    expect(loadEngineSettings({ JGTUBE_GEMINI_MODEL: 'gemini-3.8-flash' }).gemini).toBeUndefined();
  });

  test.each([
    'short',
    'has spaces in the middle of it all',
    `${KEY}\r\nx-evil: 1`,
    'x'.repeat(201),
  ])('refuses a Gemini key of the wrong shape without repeating it', (value) => {
    const attempt = () => loadEngineSettings({ GEMINI_API_KEY: value });

    expect(attempt).toThrow(/GEMINI_API_KEY: does not look like a Gemini API key/);
    expect(attempt).not.toThrow(new RegExp(value.slice(0, 5)));
  });

  test('reads a model for Antigravity, and refuses one that could pass for a flag', () => {
    expect(loadEngineSettings({ JGTUBE_AGY_MODEL: 'Gemini 3.8 Flash' }).agyModel).toBe(
      'Gemini 3.8 Flash',
    );
    expect(() =>
      loadEngineSettings({ JGTUBE_AGY_MODEL: '--dangerously-skip-permissions' }),
    ).toThrow(/JGTUBE_AGY_MODEL/);
    expect(() =>
      loadEngineSettings({ JGTUBE_GEMINI_MODEL: 'Gemini 4', GEMINI_API_KEY: KEY }),
    ).toThrow(/JGTUBE_GEMINI_MODEL/);
  });

  test('lets Antigravity try YouTube links only when the owner turns that on', () => {
    expect(loadEngineSettings({ JGTUBE_AGY_YOUTUBE_LINKS: 'on' }).agyYouTubeLinks).toBe(true);
    expect(loadEngineSettings({ JGTUBE_AGY_YOUTUBE_LINKS: 'off' }).agyYouTubeLinks).toBe(false);
    expect(() => loadEngineSettings({ JGTUBE_AGY_YOUTUBE_LINKS: 'yes' })).toThrow(
      /JGTUBE_AGY_YOUTUBE_LINKS/,
    );
  });
});

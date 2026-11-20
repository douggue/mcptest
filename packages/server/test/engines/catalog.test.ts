import { describe, expect, test } from 'vitest';
import { checkEngines, createEngines, geminiStatus } from '../../src/engines/catalog';
import { DEFAULT_ENGINE_SETTINGS } from '../../src/engines/settings';
import { scripted } from './standIn';

const withKey = {
  ...DEFAULT_ENGINE_SETTINGS,
  gemini: { apiKey: 'AIzaSyD-stand-in-key-0123456789abcdef', model: 'gemini-4-hydrogen' },
};

describe('createEngines', () => {
  test('knows Antigravity, Claude Code and Codex by the names people use', () => {
    const engines = createEngines(DEFAULT_ENGINE_SETTINGS, 'jgtube');

    expect(Object.entries(engines).map(([id, engine]) => [id, engine.id, engine.label])).toEqual([
      ['agy', 'agy', 'Antigravity CLI'],
      ['claude', 'claude', 'Claude Code'],
      ['codex', 'codex', 'Codex CLI'],
    ]);
  });
});

describe('geminiStatus', () => {
  test('is ready when a key is set, naming the model and never the key', () => {
    const status = geminiStatus(withKey);

    expect(status).toEqual({
      id: 'gemini-api',
      label: 'Gemini API',
      installed: true,
      signedIn: null,
      version: null,
      ready: true,
      note: 'Watches public YouTube videos with the model gemini-4-hydrogen.',
    });
    expect(JSON.stringify(status)).not.toContain('AIzaSyD');
  });

  test('says which setting is missing when there is no key', () => {
    expect(geminiStatus(DEFAULT_ENGINE_SETTINGS)).toMatchObject({
      installed: false,
      ready: false,
      note: expect.stringContaining('GEMINI_API_KEY'),
    });
  });
});

describe('checkEngines', () => {
  test('reports every engine in a fixed order, asking each only about itself', async () => {
    const { started, deps } = scripted((start) => {
      if (start.command === 'claude') {
        return start.args[0] === '--version' ? { stdout: '2.1.330 (Claude Code)' } : { code: 1 };
      }
      return { startError: 'ENOENT' };
    });

    const statuses = await checkEngines(createEngines(withKey, 'jgtube'), withKey, {
      ...deps,
      homeDir: '/home/owner',
      files: { exists: () => false, read: () => '' },
    });

    expect(statuses.map((status) => [status.id, status.installed, status.ready])).toEqual([
      ['agy', false, false],
      ['claude', true, false],
      ['codex', false, false],
      ['gemini-api', true, true],
    ]);
    // Nothing that would spend allowance: only version and sign-in questions.
    expect(started.map((start) => start.args.join(' ')).sort()).toEqual([
      '--version',
      '--version',
      '--version',
      'auth status',
    ]);
  });
});

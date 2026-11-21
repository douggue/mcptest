import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { inPrivateFolder } from '../src/webRunner';

const request = { prompt: 'p', systemPrompt: 's', maxTurns: 2, timeoutMs: 100, cwd: '' };

describe('a web research run', () => {
  test('starts in a fresh private folder that is gone afterwards', async () => {
    let seen = '';
    const run = inPrivateFolder(async (asked) => {
      seen = asked.cwd;
      expect(existsSync(asked.cwd)).toBe(true);
      return { text: 'x', turns: 1 };
    });

    await expect(run(request)).resolves.toEqual({ text: 'x', turns: 1 });
    expect(seen).toMatch(/jgtube-web-/);
    expect(existsSync(seen)).toBe(false);
  });

  test('removes the folder when the run fails too', async () => {
    let seen = '';
    const run = inPrivateFolder(async (asked) => {
      seen = asked.cwd;
      throw new Error('stopped');
    });

    await expect(run(request)).rejects.toThrow('stopped');
    expect(existsSync(seen)).toBe(false);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { settingsEngine } from '../src/settingsEngine';
import type { SettingsStore } from '../src/settingsStore';

const store: SettingsStore = {
  view: () => ({ settings: [], fileFound: true }),
  save: () => ({ ok: true, view: { settings: [], fileFound: true }, restart: [] }),
};

describe('settingsEngine', () => {
  test('lists the AI programs and helper programs as the engines command prints them, asked afresh', async () => {
    const asked: Array<boolean | undefined> = [];
    const settings = settingsEngine({
      store,
      env: { PATH: '' },
      engineStatus: async (fresh) => {
        asked.push(fresh);
        return {
          order: ['claude'],
          engines: [
            {
              id: 'claude',
              label: 'Claude Code',
              installed: true,
              signedIn: true,
              version: '9.9.9',
              ready: true,
              note: null,
            },
          ],
        };
      },
    });

    const report = await settings.programs();

    expect(asked).toEqual([true]);
    expect(report.engines[0]).toMatch(/tried in this order: claude/);
    expect(report.engines[1]).toMatch(
      /Claude Code \(claude\): installed, version 9\.9\.9, signed in/,
    );
    expect(report.helpers.join(' ')).toMatch(/yt-dlp: not found/);
  });

  test('passes reads and saves to the store, and allows Antigravity in the home folder given', () => {
    const home = mkdtempSync(join(tmpdir(), 'jgtube-settings-engine-'));
    const settings = settingsEngine({ store, engineStatus: async () => never(), homeDir: home });

    expect(settings.view()).toEqual({ settings: [], fileFound: true });
    expect(settings.save({ JGTUBE_REGION: 'CA' }).ok).toBe(true);
    expect(settings.allowAntigravity().ok).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });
});

const never = (): never => {
  throw new Error('not reached');
};

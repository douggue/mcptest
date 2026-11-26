import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createEngine } from '../src/engine';
import { engineStatusPath, readStatusFile, writeStatusFile } from '../src/engines/statusFile';
import type { EngineStatus, SpawnProcess } from '../src/engines/types';
import { FakeChild } from './engines/standIn';

const claude: EngineStatus = {
  id: 'claude',
  label: 'Claude Code',
  installed: true,
  signedIn: true,
  version: '2.1.0',
  ready: true,
  note: null,
};

describe('the engine status when Jgtube starts', () => {
  const folders: string[] = [];
  afterEach(() => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true })));

  function storeIn(): string {
    const folder = mkdtempSync(join(tmpdir(), 'jgtube-engines-'));
    folders.push(folder);
    return join(folder, 'jgtube.db');
  }

  test('is what the last run found, at once, while the programs are slow to answer', async () => {
    const storePath = storeIn();
    writeStatusFile(engineStatusPath(storePath), { at: Date.now(), value: [claude] });
    let started = 0;
    // Programs that never answer: a page waiting on them would never load.
    const spawn: SpawnProcess = () => {
      started += 1;
      return new FakeChild();
    };
    const engine = createEngine({ dbPath: ':memory:', region: 'US' }, { storePath, spawn });

    const report = await engine.engineStatus();

    expect(report.engines.map((status) => status.id)).toEqual(['claude', 'gemini-api']);
    expect(report.engines[0]).toEqual(claude);
    expect(started).toBe(0);
    engine.close();
  });

  test('is found out and kept for the next run when none was kept', async () => {
    const storePath = storeIn();
    const spawn: SpawnProcess = () => {
      const child = new FakeChild();
      queueMicrotask(() =>
        child.emit('error', Object.assign(new Error('spawn failed'), { code: 'ENOENT' })),
      );
      return child;
    };
    const engine = createEngine({ dbPath: ':memory:', region: 'US' }, { storePath, spawn });

    const report = await engine.engineStatus();

    const kept = readStatusFile(engineStatusPath(storePath));
    expect(kept?.value).toEqual(report.engines.filter((status) => status.id !== 'gemini-api'));
    expect(kept?.value.every((status) => !status.installed)).toBe(true);
    engine.close();
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { lastKnown } from '../../src/engines/lastKnown';
import { engineStatusPath, readStatusFile, writeStatusFile } from '../../src/engines/statusFile';
import type { EngineStatus } from '../../src/engines/types';

function checker(answers: readonly (string | Error)[]) {
  let asked = 0;
  const load = () => {
    const answer = answers[Math.min(asked, answers.length - 1)];
    asked += 1;
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? '');
  };
  return { load, asked: () => asked };
}

/** Runs a background check at once, and says how many were started. */
function runNow() {
  let started = 0;
  const later = (run: () => void) => {
    started += 1;
    run();
  };
  return { later, started: () => started };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the engine status answered at once', () => {
  test('waits for the first check when nothing is known yet', async () => {
    const check = checker(['first']);
    const status = lastKnown({ load: check.load, freshMs: 1000 });

    expect(await status()).toBe('first');
    expect(check.asked()).toBe(1);
  });

  test('answers from what was last found, without asking again while it is fresh', async () => {
    const check = checker(['first', 'second']);
    const status = lastKnown({ load: check.load, freshMs: 1000, now: () => 0 });
    await status();

    expect(await status()).toBe('first');
    expect(check.asked()).toBe(1);
  });

  test('answers an old status at once and checks again behind it', async () => {
    let clock = 0;
    const check = checker(['first', 'second']);
    const behind = runNow();
    const status = lastKnown({
      load: check.load,
      freshMs: 1000,
      now: () => clock,
      later: behind.later,
    });
    await status();
    clock = 5000;

    expect(await status()).toBe('first');
    await settle();
    expect(await status()).toBe('second');
    expect(behind.started()).toBe(1);
  });

  test('answers what a run before this one kept, before any check', async () => {
    const check = checker(['new']);
    const behind = runNow();
    const status = lastKnown({
      load: check.load,
      freshMs: 1000,
      now: () => 10_000,
      read: () => ({ at: 0, value: 'kept' }),
      later: behind.later,
    });

    expect(await status()).toBe('kept');
    await settle();
    expect(await status()).toBe('new');
  });

  test('waits the quiet start out before checking behind the page', async () => {
    const waits: number[] = [];
    const status = lastKnown({
      load: checker(['new']).load,
      freshMs: 1000,
      now: () => 2000,
      read: () => ({ at: 0, value: 'kept' }),
      quietUntil: 10_000,
      later: (_run, ms) => waits.push(ms),
    });

    await status();
    await status();

    expect(waits).toEqual([8000]);
  });

  test('checks afresh, and waits, when asked to (Settings, "Check again")', async () => {
    const check = checker(['first', 'second']);
    const status = lastKnown({ load: check.load, freshMs: 60_000, now: () => 0 });
    await status();

    expect(await status(true)).toBe('second');
  });

  test('keeps the old answer when a check behind it fails, and tries again later', async () => {
    let clock = 0;
    const check = checker(['first', new Error('stuck'), 'third']);
    const status = lastKnown({
      load: check.load,
      freshMs: 1000,
      now: () => clock,
      later: runNow().later,
    });
    await status();
    clock = 5000;

    expect(await status()).toBe('first');
    await settle();
    expect(await status()).toBe('first');
    await settle();
    expect(await status()).toBe('third');
  });

  test('does not remember a failed first check: the next call asks again', async () => {
    const check = checker([new Error('could not start'), 'second']);
    const status = lastKnown({ load: check.load, freshMs: 1000 });

    await expect(status()).rejects.toThrow('could not start');
    expect(await status()).toBe('second');
  });

  test('asks once for callers that arrive while a check runs', async () => {
    const check = checker(['first']);
    const status = lastKnown({ load: check.load, freshMs: 1000 });

    await Promise.all([status(), status(), status(true)]);

    expect(check.asked()).toBe(1);
  });

  test('keeps each new answer for the next run', async () => {
    const kept: unknown[] = [];
    const status = lastKnown({
      load: checker(['first']).load,
      freshMs: 1000,
      now: () => 7,
      write: (found) => kept.push(found),
    });

    await status();

    expect(kept).toEqual([{ at: 7, value: 'first' }]);
  });
});

describe('the engine status file beside the store', () => {
  const folders: string[] = [];
  afterEach(() => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true })));
  const fileIn = () => {
    const folder = mkdtempSync(join(tmpdir(), 'jgtube-status-'));
    folders.push(folder);
    return engineStatusPath(join(folder, 'store.db'));
  };
  const claude: EngineStatus = {
    id: 'claude',
    label: 'Claude Code',
    installed: true,
    signedIn: true,
    version: '2.1.0',
    ready: true,
    note: null,
  };

  test('reads back what was written', () => {
    const path = fileIn();
    writeStatusFile(path, { at: 5, value: [claude] });

    expect(readStatusFile(path)).toEqual({ at: 5, value: [claude] });
  });

  test('counts a missing or foreign file as nothing known', () => {
    const path = fileIn();
    expect(readStatusFile(path)).toBeNull();

    writeFileSync(path ?? '', JSON.stringify({ at: 1, value: [{ id: 'other' }] }));
    expect(readStatusFile(path)).toBeNull();
    expect(readFileSync(path ?? '', 'utf8')).toContain('other');
  });

  test('keeps nothing for a store in memory', () => {
    const path = engineStatusPath(':memory:');
    writeStatusFile(path, { at: 1, value: [claude] });

    expect(path).toBeNull();
    expect(readStatusFile(path)).toBeNull();
  });
});

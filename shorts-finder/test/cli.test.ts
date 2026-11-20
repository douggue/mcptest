import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, USAGE, runCli } from '../src/cli/run';
import { openDatabase } from '../src/db/sqlite';
import { SqliteQuotaRepo } from '../src/repos/sqliteQuotaRepo';
import { openStore } from '../src/repos/store';
import { noteOutcome } from '../src/status';
import { NOW } from './fixtures/facts';
import { newFinding } from './fixtures/findings';

let folder: string;
let dbPath: string;
let out: string[];
let err: string[];

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'shorts-cli-'));
  dbPath = join(folder, 'store.db');
  out = [];
  err = [];
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const run = (args: string[], env: Record<string, string> = {}): number =>
  runCli(args, {
    env: { SHORTS_DB_PATH: dbPath, ...env },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    now: () => NOW,
  });

describe('npm run subjects', () => {
  test('adds a keyword in every configured country, in the configured language', () => {
    const code = run(['subjects', 'add', 'bicycle repair'], {
      SHORTS_REGIONS: 'GB,AU',
      SHORTS_LANGUAGE: 'en',
    });

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([
      'Added #1 "bicycle repair" in GB, every 24 hours',
      'Added #2 "bicycle repair" in AU, every 24 hours',
    ]);
  });

  test('adds a keyword in the countries and at the hours given', () => {
    const code = run(['subjects', 'add', 'quick baking', '--regions', 'ca,us', '--every', '48']);

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([
      'Added #1 "quick baking" in CA, every 48 hours',
      'Added #2 "quick baking" in US, every 48 hours',
    ]);
  });

  test('says which subject is on the list already and still adds the others', () => {
    run(['subjects', 'add', 'paper craft', '--regions', 'US']);
    out.length = 0;

    const code = run(['subjects', 'add', 'paper craft', '--regions', 'US,GB']);

    expect(code).toBe(EXIT_FAILED);
    expect(err).toEqual(['The subject "paper craft" in US is already on the list']);
    expect(out).toEqual(['Added #2 "paper craft" in GB, every 24 hours']);
  });

  test('lists the subjects with whether each is on and when it was last searched', () => {
    run(['subjects', 'add', 'astronomy facts', '--regions', 'AU']);
    run(['subjects', 'disable', '1']);
    out.length = 0;

    const code = run(['subjects', 'list']);

    expect(code).toBe(EXIT_OK);
    expect(out).toEqual(['off #1 "astronomy facts" in AU, every 24 hours, last searched never']);
  });

  test('says how to add one when the list is empty', () => {
    run(['subjects', 'list']);

    expect(out[0]).toMatch(/^No subjects yet/);
  });

  test('turns a subject off and on again', () => {
    run(['subjects', 'add', 'paper craft', '--regions', 'US']);
    out.length = 0;

    expect(run(['subjects', 'disable', '1'])).toBe(EXIT_OK);
    expect(run(['subjects', 'enable', '1'])).toBe(EXIT_OK);

    expect(out).toEqual(['Subject #1 is now off', 'Subject #1 is now on']);
  });

  test('says so when there is no subject of that number', () => {
    expect(run(['subjects', 'disable', '7'])).toBe(EXIT_FAILED);
    expect(err).toEqual(['There is no subject #7']);
  });

  test.each([
    [['subjects']],
    [['subjects', 'add']],
    [['subjects', 'add', 'two', 'keywords']],
    [['subjects', 'add', 'x', '--every', 'daily']],
    [['subjects', 'add', 'x', '--often']],
    [['subjects', 'disable', 'first']],
    [['subjects', 'enable']],
    [['subjects', 'list', 'all']],
    [['status', 'now']],
    [['restart']],
    [[]],
  ])('shows the usage for %j and does nothing', (args) => {
    expect(run(args)).toBe(EXIT_USAGE);
    expect(err.at(-1)).toBe(USAGE);
    expect(out).toEqual([]);
  });

  test('refuses a keyword or a country that is not one, in plain words', () => {
    expect(run(['subjects', 'add', 'x', '--regions', 'Canada'])).toBe(EXIT_FAILED);
    expect(err).toEqual(['Invalid subject. the country must be a two-letter code such as US']);
  });
});

describe('npm run status', () => {
  test('shows an empty store as one where nothing has run', () => {
    const code = run(['status']);

    expect(code).toBe(EXIT_OK);
    expect(out.slice(0, 5)).toEqual([
      'Shorts finder at 2026-11-20T20:00:00.000Z',
      'YouTube API units spent today: 0 of 10,000 (searches 0, readings 0, channels 0, kept back 0)',
      'Subjects: 0 on, 0 off',
      'Videos tracked: 0 (0 due a reading)',
      'Findings waiting to be sent: 0',
    ]);
    expect(out[5]).toMatch(/^Store size on disk: \d/);
    expect(out.slice(6)).toEqual([
      'Last runs:',
      '  read     has not run yet',
      '  channels has not run yet',
      '  search   has not run yet',
      '  alerts   has not run yet',
      '  daily    has not run yet',
      '  rollup   has not run yet',
    ]);
  });

  test('shows what the service wrote: units, subjects, findings and how each round went', () => {
    const db = openDatabase(dbPath, NOW);
    const store = openStore(db);
    new SqliteQuotaRepo(db).spendWithin('2026-11-20', 'search', 1212, { kind: 6000, total: 9000 });
    store.findings.add(newFinding(1, 'A'));
    noteOutcome(
      store.state,
      { cycle: 'search', startedAt: NOW, result: 'failed', report: null, reason: 'refused (403)' },
      NOW,
    );
    noteOutcome(
      store.state,
      { cycle: 'read', startedAt: NOW, result: 'done', report: {}, reason: null },
      NOW,
    );
    db.close();
    run(['subjects', 'add', 'paper craft', '--regions', 'US,GB']);
    run(['subjects', 'disable', '2']);
    out.length = 0;

    run(['status'], { SHORTS_DAILY_UNITS: '9000' });

    expect(out[1]).toBe(
      'YouTube API units spent today: 1,212 of 9,000 (searches 1,212, readings 0, channels 0, kept back 0)',
    );
    expect(out[2]).toBe('Subjects: 1 on, 1 off');
    expect(out[4]).toBe('Findings waiting to be sent: 1');
    expect(out).toContain('  read     done at 2026-11-20T20:00:00.000Z');
    expect(out).toContain('  search   failed at 2026-11-20T20:00:00.000Z: refused (403)');
  });

  test('says the store is in memory when it is', () => {
    run(['status'], { SHORTS_DB_PATH: ':memory:' });

    expect(out[5]).toBe('Store size on disk: in memory');
  });

  test('fails naming the setting when one is wrong, without the usage', () => {
    expect(run(['status'], { SHORTS_DAILY_UNITS: 'lots' })).toBe(EXIT_FAILED);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatch(/Invalid configuration\. SHORTS_DAILY_UNITS/);
  });
});

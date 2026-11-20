import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadConfig, type Config } from '../src/config';
import { openDatabase, type Db } from '../src/db/sqlite';
import { createLogger } from '../src/log';
import { openStore } from '../src/repos/store';
import type { Store } from '../src/repos/types';
import { LAST_READ_AT } from '../src/schedule/scheduler';
import { startService, type Service } from '../src/service';
import {
  CYCLE_NAMES,
  gatherStats,
  noteOutcome,
  problemIn,
  readLastProblem,
  readOutcome,
  storeBytes,
} from '../src/status';
import { SqliteQuotaRepo } from '../src/repos/sqliteQuotaRepo';
import { expandAcrossRegions } from '../src/subjects/subject';
import { channelFacts, videoFacts, HOUR_MS, NOW, at } from './fixtures/facts';
import { newFinding } from './fixtures/findings';
import { FakeYouTube, hit } from './helpers/fakeYouTube';

const KEY = 'test-key-not-a-real-one-0123456789';
const TOKEN = '1234567890:TEST-token-not-a-real-one-0123456789';
const CHAT = '123456789';

let folder: string;
let dbPath: string;
let db: Db;
let store: Store;
let service: Service | null;
let clock: Date;
let fire: () => void;
let lines: Array<Record<string, unknown>>;
let youtube: FakeYouTube;
let telegrams: string[];
let telegramStatus: number;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'shorts-service-'));
  dbPath = join(folder, 'store.db');
  db = openDatabase(dbPath, NOW);
  store = openStore(db);
  service = null;
  clock = NOW;
  fire = () => undefined;
  lines = [];
  youtube = new FakeYouTube();
  telegrams = [];
  telegramStatus = 200;
});

afterEach(async () => {
  await service?.stop();
  db.close();
  rmSync(folder, { recursive: true, force: true });
});

const config = (env: Record<string, string> = {}): Config =>
  loadConfig({ YOUTUBE_API_KEY: KEY, SHORTS_DB_PATH: dbPath, ...env });

const TELEGRAM = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT };

/** The network: Telegram answers as told, everything else is the made-up YouTube. */
const network = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (!url.startsWith('https://api.telegram.org/')) return youtube.fetch(input, init);
  telegrams.push(JSON.parse(String(init?.body)).text);
  const body = telegramStatus === 200 ? { ok: true } : { ok: false, description: 'Unauthorized' };
  return new Response(JSON.stringify(body), { status: telegramStatus });
}) as typeof fetch;

async function start(settings: Config): Promise<void> {
  service = startService(settings, {
    log: createLogger({
      secrets: [KEY, TOKEN],
      now: () => clock,
      write: (line) => lines.push(JSON.parse(line)),
    }),
    now: () => clock,
    fetch: network,
    every: (run) => {
      fire = run;
      return 'timer';
    },
    stop: () => undefined,
  });
  await service.whenIdle();
}

async function later(ms: number): Promise<void> {
  clock = new Date(clock.getTime() + ms);
  fire();
  await service?.whenIdle();
}

const events = (name: string): Array<Record<string, unknown>> =>
  lines.filter((line) => line.event === name);

describe('the service', () => {
  test('says once that alerts are off when Telegram is not set up, and still does its rounds', async () => {
    await start(config());
    await later(HOUR_MS);

    expect(events('alerts_off')).toHaveLength(1);
    expect(events('alerts_off')[0]?.message).toMatch(/TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID/);
    expect(events('cycle').map((line) => line.cycle)).toEqual([
      'read',
      'channels',
      'rollup',
      'read',
      'channels',
    ]);
    expect(telegrams).toEqual([]);
  });

  test('searches a due subject through the official API and notes how each round went', async () => {
    expandAcrossRegions('paper craft', ['GB'], { language: 'en' }).forEach((subject) =>
      store.subjects.add(subject),
    );
    youtube.setSearch('paper craft', 'GB', [hit(1, 'A')]);
    youtube.setVideo(1, 'A', { views: 1000 });
    youtube.setChannel('A');

    await start(config());

    // The subject is new, so both of its searches are due: most-viewed and newest.
    expect(youtube.callsTo('search').map((call) => call.params['order'])).toEqual([
      'viewCount',
      'date',
    ]);
    expect(store.tracking.counts(at(2 * HOUR_MS))).toEqual({ tracked: 1, due: 1 });
    expect(readOutcome(store.state, 'search')).toEqual({ at: NOW, result: 'done', problem: null });
    expect(store.state.get(LAST_READ_AT)).toBe(NOW.toISOString());
    expect(JSON.stringify(lines)).not.toContain(KEY);
  });

  test('reads the details a search is still owed in a round of its own, with no subject due', async () => {
    const [subject] = expandAcrossRegions('night sky', ['CA']).map((entry) =>
      store.subjects.add(entry),
    );
    store.subjects.markSearched(subject!.id, 'top_recent', NOW);
    store.subjects.markSearched(subject!.id, 'newest', NOW);
    store.pending.add({
      subjectId: subject!.id,
      kind: 'newest',
      rank: 4,
      videoId: videoFacts(2, 'B').id,
      channelId: channelFacts('B').id,
      channelTitle: 'Channel B',
      foundAt: NOW,
    });
    youtube.setVideo(2, 'B', { views: 40 });

    await start(config());

    expect(youtube.callsTo('search')).toEqual([]);
    expect(store.pending.count()).toBe(0);
    expect(store.hits.videoIdsFor(subject!.id)).toEqual([videoFacts(2, 'B').id]);
  });

  test('sends a waiting finding and, at the hour, the two daily messages', async () => {
    store.findings.add(newFinding(1, 'A'));

    await start(config(TELEGRAM));

    expect(telegrams.map((text) => text.split('\n')[0])).toEqual([
      '<b>New find: a small channel with a Short taking off</b>',
      '<b>Shorts finder: summary for 20 November</b>',
      '<b>Shorts finder is still running</b>',
    ]);
    expect(telegrams[2]).toContain('Store size on disk: ');
    expect(store.findings.countWaiting()).toBe(0);
    expect(events('cycle').map((line) => line.cycle)).toEqual([
      'read',
      'channels',
      'alerts',
      'daily',
      'rollup',
    ]);
  });

  test('does not send the daily messages again after a restart on the same day', async () => {
    await start(config(TELEGRAM));
    await service?.stop();

    await start(config(TELEGRAM));

    expect(telegrams).toHaveLength(2);
    expect(events('cycle').filter((line) => line.cycle === 'read')).toHaveLength(1);
  });

  test('keeps a finding waiting, notes the problem and logs no token when Telegram refuses', async () => {
    store.findings.add(newFinding(1, 'A'));
    telegramStatus = 401;

    await start(config(TELEGRAM));

    expect(store.findings.countWaiting()).toBe(1);
    expect(readLastProblem(store.state)).toMatchObject({
      during: 'sending alerts',
      reason: expect.stringContaining('did not accept the bot token'),
    });
    expect(JSON.stringify(lines)).not.toContain(TOKEN);
    expect(JSON.stringify(lines)).not.toContain('TEST-token');
  });

  test('logs a round that fails as an error and carries on', async () => {
    db.exec('DROP TABLE video_snapshots');

    await start(config());

    const failed = lines.find((line) => line.level === 'error');
    expect(failed).toMatchObject({ event: 'cycle', cycle: 'rollup', result: 'failed' });
    expect(readOutcome(store.state, 'rollup')?.result).toBe('failed');
  });

  test('closes the store when stopped, so nothing more can be written', async () => {
    await start(config());
    const running = service;
    service = null;

    await running?.stop();
    fire();

    expect(events('cycle')).toHaveLength(3);
  });

  test('fails to start, leaving nothing open, when the store cannot be opened', () => {
    const elsewhere = join(folder, 'no-such-folder', 'store.db');

    expect(() =>
      startService(config({ SHORTS_DB_PATH: elsewhere }), {
        log: createLogger({ write: () => undefined }),
      }),
    ).toThrow();
  });
});

describe('what the service knows about itself', () => {
  const entry = { cycle: 'search', startedAt: NOW, reason: null } as const;

  test('finds no problem in a round that was done or skipped', () => {
    expect(problemIn({ ...entry, result: 'done', report: { stopped: null } })).toBeNull();
    expect(problemIn({ ...entry, result: 'done', report: 'not an object' })).toBeNull();
    expect(
      problemIn({ ...entry, result: 'skipped', report: null, reason: 'elsewhere' }),
    ).toBeNull();
  });

  test('finds the problem in a round that failed, or finished with a fault', () => {
    const failed = [{ reason: 'refused' }, { reason: 'timed out' }];

    expect(problemIn({ ...entry, result: 'failed', report: null, reason: 'broke' })).toBe('broke');
    expect(problemIn({ ...entry, result: 'failed', report: null })).toMatch(/without saying why/);
    expect(problemIn({ ...entry, result: 'done', report: { failure: 'no network' } })).toBe(
      'no network',
    );
    expect(problemIn({ ...entry, result: 'done', report: { failed: failed.slice(0, 1) } })).toBe(
      'refused',
    );
    expect(problemIn({ ...entry, result: 'done', report: { failed } })).toBe(
      '2 failed; the first: refused',
    );
    expect(
      problemIn({ ...entry, result: 'done', report: { details: { failure: 'no details' } } }),
    ).toBe('no details');
  });

  test('remembers how each round last went and the last problem among them', () => {
    noteOutcome(store.state, { ...entry, result: 'failed', report: null, reason: 'broke' }, NOW);
    noteOutcome(
      store.state,
      { ...entry, cycle: 'read', startedAt: at(HOUR_MS), result: 'done', report: {} },
      at(HOUR_MS),
    );

    expect(readOutcome(store.state, 'search')).toEqual({
      at: NOW,
      result: 'failed',
      problem: 'broke',
    });
    expect(readOutcome(store.state, 'read')?.problem).toBeNull();
    expect(readOutcome(store.state, 'rollup')).toBeNull();
    expect(readLastProblem(store.state)).toEqual({ at: NOW, during: 'searching', reason: 'broke' });
    expect(CYCLE_NAMES).toContain('daily');
  });

  test('reads a note that is damaged as no note', () => {
    store.state.set('cycle.read', '{broken', NOW);
    store.state.set('service.lastProblem', '{"at":"yesterday"}', NOW);

    expect(readOutcome(store.state, 'read')).toBeNull();
    expect(readLastProblem(store.state)).toBeNull();
  });

  test('gathers the allowance spent, the searches, the tracked videos and the store size', () => {
    const quota = new SqliteQuotaRepo(db);
    quota.spendWithin('2026-11-20', 'search', 303, { kind: 6000, total: 10_000 });
    quota.spendWithin('2026-11-20', 'reading', 4, { kind: 2000, total: 10_000 });
    store.channels.upsert(channelFacts('A'), NOW);
    store.videos.upsert(videoFacts(1, 'A'), NOW);
    store.tracking.start(videoFacts(1, 'A').id, 'yes', at(-HOUR_MS));

    const stats = gatherStats(
      { quota, tracking: store.tracking, state: store.state, dbPath, dailyUnits: 10_000 },
      NOW,
    );

    expect(stats).toMatchObject({
      unitsSpent: 307,
      dailyUnits: 10_000,
      unitsByKind: { search: 303, reading: 4, channel: 0, reserve: 0 },
      searchesToday: 3,
      tracked: 1,
      dueUnread: 1,
      lastProblem: null,
    });
    expect(stats.storeBytes).toBeGreaterThan(0);
  });

  test('has no size for a store in memory, and none for a file that is not there', () => {
    expect(storeBytes(':memory:')).toBeNull();
    expect(storeBytes(join(folder, 'missing.db'))).toBe(0);
  });
});

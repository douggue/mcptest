import {
  ReadingElsewhereError,
  SqliteChannelRepo,
  SqliteMoneyRepo,
  SqliteVideoRepo,
  openDatabase,
  type MoneyCheckOutcome,
  type MoneyVerdict,
  type YouTubeSource,
} from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApp, type JobOutcome, type JobProgress } from '../src/app';
import { NOT_READING, connectOnUse, stopWhen } from '../src/connection';
import type { ExtrasEngine } from '../src/extrasTypes';
import { JobStore } from '../src/jobs';
import { moneyEngine } from '../src/moneyEngine';
import { MAX_READ_CHANNELS, MONEY_BUSY } from '../src/moneyRoutes';
import { CHANNEL_ID, HOST, get, post, read, stubEngine, withExtras } from './support';

const NOW = new Date('2026-11-21T12:00:00Z');
const verdict: MoneyVerdict = {
  channelId: CHANNEL_ID,
  status: 'monetized',
  says: 'Monetized (sign: memberships)',
  short: '$ Monetized',
  sign: 'A Join button',
  checkedAt: NOW.toISOString(),
  videoId: 'abcdefghijk',
  bar: { key: 'over-1000', says: '1,000+ subscribers', subscribers: 2_000, note: 'n' },
};
const outcome: MoneyCheckOutcome = { verdicts: [verdict], problems: [], stoppedEarly: false };

const newJobs = () => new JobStore<JobOutcome, JobProgress>();
const appWith = (parts: Partial<ExtrasEngine>, reading = false, jobs = newJobs()) =>
  createApp({
    engine: stubEngine({ ...withExtras(parts), isReadingYouTube: () => reading }),
    jobs,
    allowedHosts: [HOST],
  });

describe('GET /api/money', () => {
  test('answers the stored verdicts of the channels asked for', async () => {
    let asked: readonly string[] = [];
    const app = appWith({
      findMoney: (ids) => {
        asked = ids;
        return [verdict];
      },
    });
    const reply = await read<{ verdicts: MoneyVerdict[] }>(
      await get(app, `/api/money?channels=${CHANNEL_ID},${CHANNEL_ID}`),
    );
    expect(reply.data.verdicts).toEqual([verdict]);
    expect(asked).toEqual([CHANNEL_ID, CHANNEL_ID]);
  });

  test('refuses no ids, too many, or one that is not a channel id', async () => {
    const app = appWith({});
    const many = Array.from({ length: MAX_READ_CHANNELS + 1 }, () => CHANNEL_ID).join(',');
    expect((await get(app, '/api/money')).status).toBe(400);
    expect((await get(app, `/api/money?channels=${many}`)).status).toBe(400);
    expect((await get(app, `/api/money?channels=${CHANNEL_ID},nope`)).status).toBe(400);
  });
});

describe('POST /api/money/check', () => {
  test('checks the channels and answers what was found', async () => {
    const app = appWith({ checkMoney: async () => outcome });
    const reply = await read<MoneyCheckOutcome>(
      await post(app, '/api/money/check', { channels: [CHANNEL_ID] }),
    );
    expect(reply.data).toEqual(outcome);
  });

  test('refuses a bad body, and work under way here or elsewhere', async () => {
    const check = { checkMoney: async () => outcome };
    expect((await post(appWith(check), '/api/money/check', { channels: [] })).status).toBe(400);
    const elsewhere = await post(appWith(check, true), '/api/money/check', {
      channels: [CHANNEL_ID],
    });
    expect(elsewhere.status).toBe(409);
    expect((await read(elsewhere)).error).toBe(MONEY_BUSY);
    const jobs = newJobs();
    let release: () => void = () => {};
    void jobs.hold(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const busy = await post(appWith(check, false, jobs), '/api/money/check', {
      channels: [CHANNEL_ID],
    });
    expect(busy.status).toBe(409);
    release();
  });

  test('a lease taken elsewhere is 409, any other failure 502 with a clean message', async () => {
    const taken = appWith({
      checkMoney: async () => {
        throw new ReadingElsewhereError();
      },
    });
    expect((await post(taken, '/api/money/check', { channels: [CHANNEL_ID] })).status).toBe(409);
    const broken = appWith({
      checkMoney: async () => {
        throw new Error('no network\n/home/someone/file.ts');
      },
    });
    const reply = await post(broken, '/api/money/check', { channels: [CHANNEL_ID] });
    expect(reply.status).toBe(502);
    const { error } = await read(reply);
    expect(error).toMatch(/^The check did not finish: no network/);
    expect(error).not.toMatch(/someone/);
  });
});

describe('moneyEngine', () => {
  test('reads verdicts from the store and checks under the lease', async () => {
    const db = openDatabase(':memory:');
    const channels = new SqliteChannelRepo(db);
    channels.upsert(
      {
        id: CHANNEL_ID,
        title: 'C',
        handle: null,
        subscribers: 600,
        subscribersHidden: false,
        videoCount: null,
      },
      NOW,
    );
    const leased: string[] = [];
    const engine = moneyEngine({
      now: () => NOW,
      repos: { channels, videos: new SqliteVideoRepo(db), money: new SqliteMoneyRepo(db) },
      source: { fetchWatchHtml: async () => '' },
      reading: async (work) => {
        leased.push('held');
        return work();
      },
    });
    expect(engine.findMoney([CHANNEL_ID])[0]).toMatchObject({ status: 'not-checked' });
    const checked = await engine.checkMoney([CHANNEL_ID]);
    expect(leased).toEqual(['held']);
    expect(checked.problems[0]?.reason).toMatch(/no stored video/);
  });
});

describe('the connection reads watch pages', () => {
  const base = {
    resolveChannelId: async () => CHANNEL_ID,
    fetchChannel: async () => ({ channel: {}, videos: [] }),
    getSidebar: async () => [],
    fetchVideoPage: async () => ({}),
  } as unknown as YouTubeSource;

  test('connects on first use and forwards the read', async () => {
    const lazy = connectOnUse(async () => ({
      ...base,
      fetchWatchHtml: async (id) => `page ${id}`,
    }));
    await expect(lazy.fetchWatchHtml('abcdefghijk')).resolves.toBe('page abcdefghijk');
  });

  test('a connection that cannot read one says so', async () => {
    await expect(connectOnUse(async () => base).fetchWatchHtml('abcdefghijk')).rejects.toThrow(
      /cannot read a watch page/,
    );
  });

  test('asks for nothing once stopped', async () => {
    let stopped = false;
    const source = stopWhen({ ...base, fetchWatchHtml: async () => 'page' }, () => stopped);
    await expect(source.fetchWatchHtml?.('abcdefghijk')).resolves.toBe('page');
    stopped = true;
    await expect(source.fetchWatchHtml?.('abcdefghijk')).rejects.toThrow(NOT_READING);
    expect(stopWhen(base, () => false).fetchWatchHtml).toBeUndefined();
  });
});

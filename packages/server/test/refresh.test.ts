import type { NicheList, RefreshProgress, YouTubeSource } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApp, type RefreshOutcome, type RefreshState } from '../src/app';
import { createEngine } from '../src/engine';
import { JobStore } from '../src/jobs';
import { CHANNEL_ID, HOST, get, post, read, stubEngine } from './support';

const PATH = '/api/refresh';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const outcome: RefreshOutcome = {
  refreshed: 48,
  failed: 2,
  notAttempted: 0,
  stoppedEarly: false,
  stillDue: 120,
  factsAdded: 0,
  factsProblem: null,
};

const idle: RefreshState = {
  last: null,
  channels: 306,
  due: 306,
  oldestReadAt: '2026-11-20T01:42:31.396Z',
  everyHours: null,
};

interface Control {
  readonly app: (request: Request) => Promise<Response>;
  readonly runs: Array<number | undefined>;
  /** Ends the refresh under way. */
  readonly finish: (result: RefreshOutcome | Error) => void;
}

function control(state: RefreshState = idle): Control {
  const runs: Array<number | undefined> = [];
  let settleRun: (result: RefreshOutcome | Error) => void = () => {};
  const engine = stubEngine({
    refreshStatus: () => state,
    refresh: (onProgress, maxChannels) => {
      runs.push(maxChannels);
      onProgress({ stage: 'refreshing', done: 3, total: 50 });
      return new Promise<RefreshOutcome>((resolve, reject) => {
        settleRun = (result) => (result instanceof Error ? reject(result) : resolve(result));
      });
    },
    crawl: () => new Promise(() => {}),
  });
  return {
    runs,
    finish: (result) => settleRun(result),
    app: createApp({
      engine,
      jobs: new JobStore(() => `job-${runs.length + 1}`),
      allowedHosts: [HOST],
    }),
  };
}

describe('POST /api/refresh', () => {
  test('starts a refresh in the background and reports the job so it can be polled', async () => {
    const { app, runs, finish } = control();

    const response = await post(app, PATH, {});
    await settle();

    expect(response.status).toBe(202);
    expect((await read(response)).data).toEqual({ jobId: 'job-1' });
    expect(runs).toEqual([undefined]);
    expect((await read(await get(app, '/api/jobs/job-1'))).data).toMatchObject({
      status: 'running',
      progress: { stage: 'refreshing', done: 3, total: 50 },
    });

    finish(outcome);
    await settle();

    expect((await read(await get(app, '/api/jobs/job-1'))).data).toMatchObject({
      status: 'done',
      result: outcome,
    });
  });

  test('passes on how many channels to read, within limits', async () => {
    const { app, runs } = control();

    expect((await post(app, PATH, { maxChannels: 10 })).status).toBe(202);
    await settle();

    expect(runs).toEqual([10]);
  });

  test.each([[{ maxChannels: 0 }], [{ maxChannels: 501 }], [{ maxChannels: 'all' }], ['[]']])(
    'rejects %j',
    async (body) => {
      const { app, runs } = control();

      expect((await post(app, PATH, body)).status).toBe(400);
      expect(runs).toEqual([]);
    },
  );

  test('refuses a second refresh, and a new map, while one is running', async () => {
    const { app, finish } = control();
    await post(app, PATH, {});
    await settle();

    expect((await post(app, PATH, {})).status).toBe(409);
    expect((await post(app, '/api/maps', { channel: CHANNEL_ID })).status).toBe(409);

    finish(outcome);
    await settle();

    expect((await post(app, PATH, {})).status).toBe(202);
  });

  test('is refused while a map is being made', async () => {
    const { app, runs } = control();
    await post(app, '/api/maps', { channel: CHANNEL_ID });

    const response = await post(app, PATH, {});

    expect(response.status).toBe(409);
    expect((await read(response)).error).toMatch(/already/);
    expect(runs).toEqual([]);
  });

  test('reports a refresh that fails without failing the request or leaking where files live', async () => {
    const { app, finish } = control();
    await post(app, PATH, {});
    await settle();

    finish(new Error('disk full at /home/someone/jgtube/store.db'));
    await settle();

    const job = (await read<{ status: string; error: string }>(await get(app, '/api/jobs/job-1')))
      .data;
    expect(job.status).toBe('failed');
    expect(job.error).not.toContain('/home/someone');
  });

  test('rejects requests from another site and bodies that are not JSON', async () => {
    const { app, runs } = control();

    expect((await post(app, PATH, {}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(app, PATH, {}, { 'content-type': 'text/plain' })).status).toBe(415);
    expect(runs).toEqual([]);
  });
});

describe('GET /api/refresh', () => {
  test('says when the store was last refreshed and that nothing is running', async () => {
    const state: RefreshState = {
      ...idle,
      everyHours: 6,
      last: {
        startedAt: '2026-11-20T06:00:00.000Z',
        finishedAt: '2026-11-20T06:04:00.000Z',
        refreshed: 48,
        failed: 2,
        stoppedEarly: false,
      },
    };

    const response = await get(control(state).app, PATH);

    expect(response.status).toBe(200);
    expect((await read(response)).data).toEqual({ ...state, running: false, jobId: null });
  });

  test('names the job while a refresh is running, and lets go of it afterwards', async () => {
    const { app, finish } = control();
    await post(app, PATH, {});
    await settle();

    expect((await read(await get(app, PATH))).data).toMatchObject({
      running: true,
      jobId: 'job-1',
    });

    finish(outcome);
    await settle();

    expect((await read(await get(app, PATH))).data).toMatchObject({ running: false, jobId: null });
  });

  test('answers 405 to other methods and 403 to another host', async () => {
    const { app } = control();
    const put = new Request(`http://${HOST}${PATH}`, { method: 'PUT', headers: { host: HOST } });

    expect((await app(put)).status).toBe(405);
    expect((await get(app, PATH, 'evil.example')).status).toBe(403);
  });
});

describe('a refresh with the real engine and store', () => {
  const DAY_MS = 86_400_000;
  const START = new Date('2026-11-18T12:00:00Z');
  const cid = (letter: string) => `UC${letter.repeat(22)}`;

  /** A small channel whose newest video has taken off; every read finds 500 more views on each. */
  function growingSource(): YouTubeSource {
    let reads = 0;
    return {
      resolveChannelId: async () => cid('N'),
      getSidebar: async () => [],
      fetchChannel: async (channelId) => {
        reads += 1;
        return {
          channel: {
            id: channelId,
            title: 'Niche channel',
            handle: 'niche',
            subscribers: 900,
            subscribersHidden: false,
            videoCount: 5,
          },
          videos: [40_000, 1000, 1200, 900, 1100].map((views, index) => ({
            id: `NNNNNNNNN${String(index).padStart(2, '0')}`,
            channelId,
            title: `How it was built ${index}`,
            views: views + 500 * reads,
            durationSeconds: 900,
            published: {
              date: new Date(START.getTime() - (5 + index * 7) * DAY_MS),
              precision: 'day' as const,
              raw: `${5 + index * 7}d ago`,
            },
          })),
        };
      },
    };
  }

  test('reads a stale channel again, records the run, and the niche list shows what it gained', async () => {
    let now = START;
    const real = createEngine(
      { dbPath: ':memory:', region: 'US', refreshHours: 12 },
      { createSource: async () => growingSource(), now: () => now },
    );
    const live = createApp({ engine: real, jobs: new JobStore(), allowedHosts: [HOST] });
    const seen: RefreshProgress[] = [];

    await real.crawl('@niche', 1, () => {});
    expect((await read<{ due: number }>(await get(live, PATH))).data.due).toBe(0);
    now = new Date(START.getTime() + 2 * DAY_MS);
    const result = await real.refresh((progress) => seen.push(progress));

    expect(result).toEqual({
      refreshed: 1,
      failed: 0,
      notAttempted: 0,
      stoppedEarly: false,
      stillDue: 0,
      factsAdded: 0,
      factsProblem: null,
    });
    expect(seen.at(-1)).toEqual({ stage: 'refreshing', done: 1, total: 1 });
    expect((await read(await get(live, PATH))).data).toMatchObject({
      last: { refreshed: 1, failed: 0, finishedAt: now.toISOString() },
      channels: 1,
      due: 0,
      everyHours: 12,
      running: false,
    });
    real.setNicheWatched(cid('N'), true);
    const niches = (await read<NicheList>(await get(live, '/api/niches'))).data;
    expect(niches.channels[0]?.growth).toEqual({
      views: 5 * 500,
      days: 2,
      since: START.toISOString(),
    });
    real.close();
  });

  test('does not even connect to YouTube when no channel is due', async () => {
    let connections = 0;
    const real = createEngine(
      { dbPath: ':memory:', region: 'US' },
      {
        createSource: async () => {
          connections += 1;
          return growingSource();
        },
        now: () => START,
      },
    );

    const result = await real.refresh(() => {});

    expect(result).toMatchObject({ refreshed: 0, failed: 0, stillDue: 0 });
    expect(connections).toBe(0);
    expect(real.refreshStatus().last).toMatchObject({ refreshed: 0, failed: 0 });
    real.close();
  });
});

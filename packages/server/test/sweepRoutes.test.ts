import type {
  ChannelSnapshot,
  NicheList,
  SidebarItem,
  SweepInfo,
  SweepResult,
  YouTubeSource,
} from '@jgtube/core';
import { afterEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import type { FindInfo } from '../src/bankTypes';
import { createEngine, type RunningEngine } from '../src/engine';
import { JobStore, type Job } from '../src/jobs';
import { startSweepThroughApi } from '../src/schedule';
import { HOST, get, post, read } from './support';

const DAY_MS = 86_400_000;
const START = new Date('2026-11-20T12:00:00Z');
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const topVideo = (letter: string) => `${letter.repeat(9)}00`;
/** One video far above the rest: a small, new channel that qualifies as a niche. */
const TOOK_OFF = [60_000, 1000, 1100, 900, 1200, 1000];
const FLAT = [1000, 1000, 1100, 900, 1200, 1000];

function snapshot(channelId: string, now: Date): ChannelSnapshot {
  const letter = channelId.charAt(2);
  const views = letter === letter.toLowerCase() ? FLAT : TOOK_OFF;
  return {
    channel: {
      id: channelId,
      title: `Channel ${letter}`,
      handle: `@chan${letter}`,
      subscribers: 4000,
      subscribersHidden: false,
      videoCount: views.length,
    },
    videos: views.map((count, index) => ({
      id: `${channelId.slice(-9)}${String(index).padStart(2, '0')}`,
      channelId,
      title: `Lost city number ${index}`,
      views: count,
      durationSeconds: 700,
      published: {
        date: new Date(now.getTime() - (3 + index * 6) * DAY_MS),
        precision: 'day' as const,
        raw: `${3 + index * 6}d ago`,
      },
    })),
  };
}

const beside = (letters: string): SidebarItem[] =>
  [...letters].map((letter) => ({
    videoId: topVideo(letter),
    title: 'Beside',
    channelId: cid(letter),
    channelName: `Channel ${letter}`,
    channelHandle: null,
    views: 10,
    published: null,
  }));

let engines: RunningEngine[] = [];
afterEach(() => {
  engines.forEach((engine) => engine.close());
  engines = [];
});

interface Options {
  /** What each keyword finds, as channel letters. */
  readonly results?: Readonly<Record<string, string>>;
  readonly sidebars?: Readonly<Record<string, string>>;
  /** Channels whose read meets a sign-in wall. */
  readonly walled?: string;
}

function world(options: Options = {}) {
  const calls = { searches: [] as string[], channels: [] as string[], sidebars: [] as string[] };
  let now = START;
  const source: YouTubeSource & { searchVideos(q: string): Promise<never[]> } = {
    resolveChannelId: async () => cid('Z'),
    fetchVideoPage: async () => {
      throw new Error('unused');
    },
    getSidebar: async (videoId) => {
      calls.sidebars.push(videoId);
      return beside(options.sidebars?.[videoId] ?? '');
    },
    fetchChannel: async (channelId) => {
      calls.channels.push(channelId);
      if (options.walled?.includes(channelId.charAt(2))) {
        throw new Error('Sign in to confirm you’re not a bot');
      }
      return snapshot(channelId, now);
    },
    searchVideos: async (query: string) => {
      calls.searches.push(query);
      return [...(options.results?.[query] ?? '')].map((letter) => ({
        videoId: topVideo(letter),
        channelId: cid(letter),
      })) as never[];
    },
  };
  const engine = createEngine(
    { dbPath: ':memory:', region: 'US' },
    { createSource: async () => source, now: () => now },
  );
  engines.push(engine);
  const jobs = new JobStore<never, never>();
  const app = createApp({ engine, jobs: jobs as never, allowedHosts: [HOST] });
  return {
    engine,
    app,
    jobs,
    calls,
    later: (hours: number) => {
      now = new Date(now.getTime() + hours * 3_600_000);
    },
  };
}

type App = (request: Request) => Promise<Response>;

const info = async (app: App) =>
  (await read<SweepInfo & { jobId: string | null }>(await get(app, '/api/niches/sweep'))).data;

async function finished(app: App, id: string) {
  for (let tries = 0; tries < 100; tries += 1) {
    const job = (await read<Job<SweepResult, unknown>>(await get(app, `/api/jobs/${id}`))).data;
    if (job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the job did not finish');
}

async function sweepNow(app: App, body: object = {}) {
  const started = await post(app, '/api/niches/sweep', body);
  expect(started.status).toBe(202);
  const { jobId } = (await read<{ jobId: string }>(started)).data;
  return finished(app, jobId);
}

const addKeyword = (app: App, keyword: string) =>
  post(app, '/api/niches/sweep/keywords', { action: 'add', keyword });

describe('the niche watchlist', () => {
  test('starts empty, at the default budget, with the schedule off', async () => {
    const { app } = world();
    const first = await info(app);
    expect(first).toMatchObject({
      via: 'pages',
      keywords: [],
      suggestions: [],
      settings: { everyDays: null, pageBudget: 400 },
      budget: { pages: { cap: 400, used: 0, left: 400 }, units: null },
      plan: { keywords: 0 },
      last: null,
      restingUntil: null,
      jobId: null,
    });
    expect(first.cannotStart).toMatch(/Add a keyword/);
  });

  test('keeps keywords: add, pause, resume, remove; no doubles, no empty ones', async () => {
    const { app } = world();
    const added = (await read<SweepInfo>(await addKeyword(app, '  lost   cities '))).data;
    expect(added.keywords).toEqual([
      { id: 1, keyword: 'lost cities', paused: false, lastSweptAt: null, found: 0 },
    ]);
    expect(added.plan).toMatchObject({ keywords: 1, keywordsCovered: 1 });
    expect(added.cannotStart).toBeNull();
    expect((await addKeyword(app, 'Lost Cities')).status).toBe(409);
    expect((await addKeyword(app, ' ')).status).toBe(400);
    const change = (action: string, id: number) =>
      post(app, '/api/niches/sweep/keywords', { action, id });
    const paused = (await read<SweepInfo>(await change('pause', 1))).data;
    expect(paused.keywords[0]?.paused).toBe(true);
    expect(paused.plan.keywords).toBe(0);
    expect((await read<SweepInfo>(await change('resume', 1))).data.keywords[0]?.paused).toBe(false);
    expect((await change('pause', 99)).status).toBe(404);
    expect((await read<SweepInfo>(await change('remove', 1))).data.keywords).toEqual([]);
    expect((await change('remove', 1)).status).toBe(404);
    expect((await post(app, '/api/niches/sweep/keywords', { action: 'shout' })).status).toBe(400);
  });

  test('saves the schedule and the budget inside their bounds', async () => {
    const { app } = world();
    const save = (body: object) => post(app, '/api/niches/sweep/settings', body);
    const saved = (await read<SweepInfo>(await save({ everyDays: 3, pageBudget: 2000 }))).data;
    expect(saved.settings).toEqual({ everyDays: 3, pageBudget: 2000 });
    expect(saved.budget.pages.cap).toBe(2000);
    expect((await save({ everyDays: null, pageBudget: 2001 })).status).toBe(400);
    expect((await save({ everyDays: 0, pageBudget: 400 })).status).toBe(400);
    expect((await save({ pageBudget: 400 })).status).toBe(400);
    // "Find more outliers" reads under the same budget.
    const find = (await read<FindInfo>(await get(app, '/api/bank/find?channels=5'))).data;
    expect(find.allowance.cap).toBe(2000);
  });
});

describe('sweep now', () => {
  test('reads what the keywords find, snowballs from new niches, and says how each was found', async () => {
    const { app, calls } = world({
      results: { 'lost cities': 'ABb' },
      sidebars: { [topVideo('A')]: 'SB' },
    });
    await addKeyword(app, 'lost cities');
    const job = await sweepNow(app);

    expect(job.status).toBe('done');
    expect(job.result).toMatchObject({ stopped: 'done', via: 'pages' });
    expect(job.result?.summary.keywords).toEqual([
      expect.objectContaining({
        keyword: 'lost cities',
        channelsRead: 3,
        qualified: 2,
        requests: 16,
      }),
    ]);
    expect(job.result?.summary.snowball).toMatchObject({
      sources: 2,
      channelsRead: 1,
      qualified: 1,
    });
    expect(job.result?.summary.newNiches).toBe(3);
    expect(calls.searches).toEqual(['lost cities']);
    expect(calls.channels).toEqual([cid('A'), cid('B'), cid('b'), cid('S')]);

    const listed = (
      await read<{ jobs: { kind: string; title: string }[] }>(await get(app, '/api/jobs'))
    ).data;
    expect(listed.jobs.find((one) => one.kind === 'niche-sweep')?.title).toMatch(/Sweeping/);

    const after = await info(app);
    expect(after.keywords[0]).toMatchObject({ found: 2, lastSweptAt: START.toISOString() });
    expect(after.budget.pages.used).toBe(job.result?.spent.pages);
    expect(after.last).toMatchObject({ stopped: 'done', requests: job.result?.spent.pages });
    expect(after.last?.summary?.newNiches).toBe(3);

    const niches = (await read<NicheList>(await get(app, '/api/niches'))).data;
    expect(niches.newSinceSweep).toBe(3);
    expect(niches.lastSweepAt).toBe(START.toISOString());
    const byId = new Map(niches.channels.map((channel) => [channel.id, channel]));
    expect(byId.get(cid('A'))).toMatchObject({
      foundBy: { kind: 'keyword', keyword: 'lost cities' },
      newSinceSweep: true,
    });
    expect(byId.get(cid('S'))?.foundBy).toEqual({
      kind: 'snowball',
      fromChannelId: cid('A'),
      fromTitle: 'Channel A',
    });
    expect(byId.has(cid('b'))).toBe(false);
    // Every video read is in the outlier bank.
    const bank = (await read<{ page: { total: number } }>(await get(app, '/api/bank'))).data;
    expect(bank.page.total).toBe(4 * 6);
    // And "Find more outliers" sees the same day's spending.
    const find = (await read<FindInfo>(await get(app, '/api/bank/find'))).data;
    expect(find.allowance.used).toBe(job.result?.spent.pages);
  });

  test('is refused with nothing to sweep, while something else reads YouTube, and twice at once', async () => {
    const { app, jobs } = world({ results: { one: 'A' } });
    expect((await post(app, '/api/niches/sweep', {})).status).toBe(409);
    await addKeyword(app, 'one');
    let release: () => void = () => {};
    jobs.start(
      () => new Promise<never>((_resolve, reject) => (release = () => reject(new Error('x')))),
      {
        kind: 'refresh',
        title: 'Refreshing',
      } as never,
    );
    const busy = await post(app, '/api/niches/sweep', {});
    expect(busy.status).toBe(409);
    expect((await read<{ error: string }>(busy)).error).toMatch(/reading YouTube/);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await post(app, '/api/niches/sweep', { by: 'someone' })).status).toBe(400);
    expect((await get(app, '/api/niches/sweep/keywords')).status).toBe(405);
  });

  test('cannot spend past the day’s budget: the next sweep is refused until the day has passed', async () => {
    const { app, calls, later } = world({
      results: { 'key 1': 'ABCDEFGHIJ', 'key 2': 'KLMNOPQRST', 'key 3': 'abcdefghij' },
    });
    await post(app, '/api/niches/sweep/settings', { everyDays: null, pageBudget: 100 });
    for (const n of '123') await addKeyword(app, `key ${n}`);

    const job = await sweepNow(app);
    expect(job.result?.stopped).toBe('budget');
    expect(job.result?.message).toMatch(/budget/);
    const asked = calls.searches.length + calls.channels.length * 5 + calls.sidebars.length * 2;
    expect(asked).toBeLessThanOrEqual(100);
    expect(job.result?.spent.pages).toBe(asked);

    const used = await info(app);
    expect(used.budget.pages.left).toBe(100 - asked);
    const second = await sweepNow(app);
    const askedNow = calls.searches.length + calls.channels.length * 5 + calls.sidebars.length * 2;
    expect(askedNow).toBeLessThanOrEqual(100);
    expect(second.result?.stopped).toBe('budget');
    const spent = await info(app);
    expect(spent.cannotStart).toMatch(/budget/);
    const refused = await post(app, '/api/niches/sweep', {});
    expect(refused.status).toBe(429);

    later(25);
    expect((await info(app)).budget.pages.used).toBe(0);
    expect((await sweepNow(app)).status).toBe('done');
  });

  test('a sign-in wall stops it for the day: no second attempt, by the button or the schedule', async () => {
    const { app, calls, later } = world({ results: { one: 'AB', two: 'C' }, walled: 'A' });
    await addKeyword(app, 'one');
    await addKeyword(app, 'two');
    await post(app, '/api/niches/sweep/settings', { everyDays: 1, pageBudget: 400 });

    const job = await sweepNow(app);
    expect(job.result?.stopped).toBe('refused');
    expect(job.result?.message).toMatch(/YouTube refused/);
    expect(calls.channels).toEqual([cid('A')]);
    expect(calls.searches).toEqual(['one']);

    const resting = await info(app);
    expect(resting.restingUntil).toBe(new Date(START.getTime() + DAY_MS).toISOString());
    expect(resting.cannotStart).toMatch(/refused/);
    expect((await post(app, '/api/niches/sweep', {})).status).toBe(429);
    const scheduled = await post(app, '/api/niches/sweep', { by: 'schedule' });
    expect(scheduled.status).toBe(200);
    expect((await read<{ started: boolean }>(scheduled)).data.started).toBe(false);
    expect(calls.channels).toEqual([cid('A')]);

    later(25);
    expect((await info(app)).restingUntil).toBeNull();
  });
});

describe('the schedule', () => {
  test('starts a sweep only when one is due, and never when off', async () => {
    const { app, later } = world({ results: { one: 'A' } });
    await addKeyword(app, 'one');
    const turn = async () => {
      const reply = await post(app, '/api/niches/sweep', { by: 'schedule' });
      if (reply.status === 202) {
        await finished(app, (await read<{ jobId: string }>(reply)).data.jobId);
      }
      return reply.status;
    };
    expect(await turn()).toBe(200);
    await post(app, '/api/niches/sweep/settings', { everyDays: 2, pageBudget: 400 });
    expect(await turn()).toBe(202);
    expect((await info(app)).last?.startedBy).toBe('schedule');
    later(30);
    expect(await turn()).toBe(200);
    later(15);
    expect(await turn()).toBe(202);
  });
});

describe('the server’s hourly turn', () => {
  test('asks the sweep’s own route: it waits when nothing is due and comes back sooner when YouTube is being read', async () => {
    const { app, jobs } = world({ results: { one: 'A' } });
    await addKeyword(app, 'one');
    const turn = startSweepThroughApi(app, HOST);
    // The schedule is off: nothing to do, and the timer waits its hour.
    expect(await turn()).toBe(true);
    expect((await info(app)).last).toBeNull();

    await post(app, '/api/niches/sweep/settings', { everyDays: 1, pageBudget: 400 });
    let release: () => void = () => {};
    jobs.start(
      () => new Promise<never>((_resolve, reject) => (release = () => reject(new Error('x')))),
      {
        kind: 'map',
        title: 'Making a map',
      } as never,
    );
    // A map is being made at its turn: never beside it.
    expect(await turn()).toBe(false);
    expect((await info(app)).last).toBeNull();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await turn()).toBe(true);
    const running = (await info(app)).jobId;
    expect(running).not.toBeNull();
    await finished(app, running ?? '');
    expect((await info(app)).last).toMatchObject({ startedBy: 'schedule', stopped: 'done' });
    await expect(startSweepThroughApi(app, 'other.example:1')()).rejects.toThrow(/403/);
  });
});

describe('what a sweep leaves for the other views', () => {
  test('What changed and Alerts say how many new niche channels were found', async () => {
    const { app, engine, later } = world({ results: { one: 'AB' } });
    await engine.crawl('@chanZ', 1, () => {});
    const changes = async () =>
      (
        await read<{ newNiches: number }>(
          await get(app, `/api/changes?channel=${cid('Z')}&since=week`),
        )
      ).data.newNiches;
    const alerts = async () =>
      (
        await read<{ newNiches: { count: number; at: string } | null }>(
          await get(app, `/api/alerts?channel=${cid('Z')}`),
        )
      ).data.newNiches;
    expect(await changes()).toBe(0);
    expect(await alerts()).toBeNull();
    await addKeyword(app, 'one');
    await sweepNow(app);
    expect(await changes()).toBe(2);
    expect(await alerts()).toEqual({ count: 2, at: START.toISOString() });
    later(8 * 24);
    expect(await changes()).toBe(0);
  });
});

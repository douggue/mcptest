import { type BankPage, type ChannelSnapshot, type YouTubeSource } from '@jgtube/core';
import {
  BANK_FIND_DAILY_PAGE_REQUESTS,
  PAGE_REQUESTS_PER_CHANNEL,
} from '@jgtube/core/src/bank/cost';
import { afterEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import type { BankLook, FindInfo, FindResult } from '../src/bankTypes';
import { closenessTable } from '../src/bankEngine';
import { createEngine, type RunningEngine } from '../src/engine';
import { JobStore, type Job } from '../src/jobs';
import { HOST, get, post, read } from './support';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-20T12:00:00Z');
const KEY = 'a-key-of-plausible-length';
const cid = (letter: string) => `UC${letter.repeat(22)}`;

function snapshot(channelId: string, views: readonly number[]): ChannelSnapshot {
  const letter = channelId.charAt(2);
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
      title: `Rocket build number ${index}`,
      views: count,
      durationSeconds: 700,
      published: {
        date: new Date(NOW.getTime() - (3 + index * 6) * DAY_MS),
        precision: 'day' as const,
        raw: `${3 + index * 6}d ago`,
      },
    })),
  };
}

const VIEWS = [60_000, 1000, 1100, 900, 1200, 1000];

function source(searches: string[]): YouTubeSource & { searchVideos(q: string): Promise<never[]> } {
  return {
    resolveChannelId: async () => cid('A'),
    fetchVideoPage: async () => {
      throw new Error('unused');
    },
    getSidebar: async () => [],
    fetchChannel: async (channelId) => snapshot(channelId, VIEWS),
    searchVideos: async (query: string) => {
      searches.push(query);
      if (query.startsWith('many')) {
        return Array.from({ length: 25 }, (_, n) => ({
          videoId: `v${String(searches.length * 100 + n).padStart(10, '0')}`,
          channelId: `UC${String(searches.length * 100 + n).padStart(22, 'x')}`,
        })) as never[];
      }
      return [
        { videoId: 'BBBBBBBBB00', channelId: cid('B') },
        { videoId: 'CCCCCCCCC00', channelId: cid('C') },
      ] as never[];
    },
  };
}

let engines: RunningEngine[] = [];
afterEach(() => {
  engines.forEach((engine) => engine.close());
  engines = [];
});

function world(apiKey?: string) {
  const searches: string[] = [];
  const apiReads: string[] = [];
  const engine = createEngine(
    { dbPath: ':memory:', region: 'US', ...(apiKey ? { youtubeApiKey: apiKey } : {}) },
    {
      createSource: async () => source(searches),
      now: () => NOW,
      search: async (query) => {
        searches.push(`api:${query}`);
        return [
          {
            videoId: 'DDDDDDDDD00',
            channelId: cid('D'),
            channelTitle: 'D',
            title: 't',
            publishedAt: NOW,
          },
        ];
      },
      fetchApiChannel: async (channelId, _max, options) => {
        apiReads.push(channelId);
        options.onRequest?.();
        options.onRequest?.();
        return snapshot(channelId, VIEWS);
      },
    },
  );
  engines.push(engine);
  const jobs = new JobStore<never, never>();
  const app = createApp({ engine, jobs: jobs as never, allowedHosts: [HOST] });
  return { engine, app, searches, apiReads };
}

async function finished(app: (r: Request) => Promise<Response>, id: string) {
  for (let tries = 0; tries < 50; tries += 1) {
    const job = (await read<Job<FindResult, unknown>>(await get(app, `/api/jobs/${id}`))).data;
    if (job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the job did not finish');
}

describe('the outlier bank routes', () => {
  test('look at every stored video with filters, and say how many of all', async () => {
    const { app, engine } = world();
    await engine.crawl('@chanA', 1, () => {});
    const all = (await read<BankLook>(await get(app, '/api/bank'))).data;
    expect(all.page.total).toBe(6);
    expect(all.page.videos[0]?.channel).toMatchObject({ id: cid('A'), onAMap: true });
    const tenX = (await read<BankLook>(await get(app, '/api/bank?score=10&limit=2'))).data.page;
    expect(tenX.matched).toBe(1);
    expect(tenX.limit).toBe(2);
    const none = (await read<{ page: BankPage }>(await get(app, '/api/bank?contains=nothing')))
      .data;
    expect(none.page.matched).toBe(0);
  });

  test('find more outliers without a key: says the cost, runs as a job, grows the bank', async () => {
    const { app, searches } = world();
    const info = (await read<FindInfo>(await get(app, '/api/bank/find?channels=2'))).data;
    expect(info).toMatchObject({
      via: 'pages',
      plan: { requests: 1 + 2 * PAGE_REQUESTS_PER_CHANNEL, apiUnits: 0 },
      allowance: { cap: BANK_FIND_DAILY_PAGE_REQUESTS, used: 0 },
    });
    expect(info.topics).toContain('Science & space');

    const started = await post(app, '/api/bank/find', { query: 'rockets', channels: 2 });
    expect(started.status).toBe(202);
    const { jobId } = (await read<{ jobId: string }>(started)).data;
    const job = await finished(app, jobId);
    expect(job.status).toBe('done');
    expect(job.result).toMatchObject({ channelsRead: 2, bankBefore: 0, bankAfter: 12 });
    expect(searches).toEqual(['rockets']);

    const listed = (await read<{ jobs: { kind: string }[] }>(await get(app, '/api/jobs'))).data;
    expect(listed.jobs.map((one) => one.kind)).toContain('bank-find');
    const after = (await read<FindInfo & { lastJobId: string }>(await get(app, '/api/bank/find')))
      .data;
    expect(after.allowance.used).toBe(1 + 2 * PAGE_REQUESTS_PER_CHANNEL);
    expect(after.lastJobId).toBe(jobId);
  });

  test('with a key it searches and reads channels through the official API', async () => {
    const { app, searches, apiReads } = world(KEY);
    const { jobId } = (
      await read<{ jobId: string }>(
        await post(app, '/api/bank/find', { query: 'rockets', channels: 3 }),
      )
    ).data;
    const job = await finished(app, jobId);
    expect(job.result).toMatchObject({ via: 'api', channelsRead: 1, requests: 3, apiUnits: 102 });
    expect(searches).toEqual(['api:rockets']);
    expect(apiReads).toEqual([cid('D')]);
  });

  test('refuses a find it cannot take, and one beyond the cap', async () => {
    const { app } = world();
    expect((await post(app, '/api/bank/find', { query: '', channels: 2 })).status).toBe(400);
    expect((await post(app, '/api/bank/find', { query: 'x', channels: 99 })).status).toBe(400);
    for (let run = 0; run < 15; run += 1) {
      const response = await post(app, '/api/bank/find', { query: `many${run}`, channels: 25 });
      if (response.status === 429) {
        expect((await read(response)).error).toMatch(/left/);
        return;
      }
      await finished(app, (await read<{ jobId: string }>(response)).data.jobId);
    }
    throw new Error('the cap was never reached');
  });

  test('collections: make, add, filter by, export and delete', async () => {
    const { app, engine } = world();
    await engine.crawl('@chanA', 1, () => {});
    const made = await read<{ collection: { id: number } }>(
      await post(app, '/api/bank/collections/create', { name: 'Hooks to steal' }),
    );
    const { id } = made.data.collection;
    expect((await post(app, '/api/bank/collections/create', { name: ' ' })).status).toBe(400);
    expect(
      (await post(app, '/api/bank/collections/add', { id, video: 'AAAAAAAAA00' })).status,
    ).toBe(200);
    expect(
      (await post(app, '/api/bank/collections/add', { id: 99, video: 'AAAAAAAAA00' })).status,
    ).toBe(404);
    const inIt = (await read<BankLook>(await get(app, `/api/bank?collection=c${id}`))).data;
    expect(inIt.page.videos.map((v) => v.videoId)).toEqual(['AAAAAAAAA00']);
    expect(inIt.collections).toMatchObject([{ id, name: 'Hooks to steal', count: 1 }]);

    const csv = await get(app, `/api/bank/collections/export?id=${id}&as=csv`);
    expect(csv.headers.get('content-disposition')).toContain('Hooks-to-steal.csv');
    expect(await csv.text()).toContain('AAAAAAAAA00');
    const md = await get(app, `/api/bank/collections/export?id=${id}&as=md`);
    expect(await md.text()).toContain('# Hooks to steal');
    expect((await get(app, `/api/bank/collections/export?id=${id}&as=pdf`)).status).toBe(400);
    expect((await get(app, '/api/bank/collections/export?id=77&as=md')).status).toBe(404);

    await post(app, '/api/bank/collections/remove', { id, video: 'AAAAAAAAA00' });
    const list = await read<{ collections: { count: number }[] }>(
      await get(app, '/api/bank/collections'),
    );
    expect(list.data.collections[0]?.count).toBe(0);
    expect((await post(app, '/api/bank/collections/delete', { id })).status).toBe(200);
    expect((await post(app, '/api/bank/collections/delete', { id })).status).toBe(404);
    expect((await post(app, '/api/bank', {})).status).toBe(405);
  });
});

describe('closeness on the owner’s maps', () => {
  test('keeps the closest tier across maps and never the centre itself', () => {
    const map = (center: string, tiers: Record<string, 'close' | 'medium' | 'far'>) =>
      ({
        center: { id: center, title: `Centre ${center}` },
        channels: Object.entries(tiers).map(([id, tier]) => ({ id, tier })),
      }) as never;
    const table = closenessTable([
      map('X', { X: 'close', A: 'far', B: 'medium' }),
      map('Y', { A: 'close', B: 'far' }),
    ]);
    expect(table.get('X')).toBeUndefined();
    expect(table.get('A')).toEqual({ centerId: 'Y', centerTitle: 'Centre Y', tier: 'close' });
    expect(table.get('B')?.tier).toBe('medium');
  });
});

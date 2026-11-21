import {
  ReadingElsewhereError,
  type LogoOutcome,
  type LogoProgress,
  type MapSnapshot,
  type YouTubeSource,
} from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApp, type AppOptions, type Engine } from '../src/app';
import { createEngine } from '../src/engine';
import { JobStore, type Job } from '../src/jobs';
import { LOGOS_WAIT } from '../src/logoRoutes';
import { CHANNEL_ID, HOST, get, post, read, stubEngine } from './support';

const PATH = '/api/logos';
const OTHER = 'UC0000000000000000000001';
const DONE: LogoOutcome = { asked: 1, found: 1, failed: 0, stoppedEarly: false };

type LogoJob = Job<LogoOutcome, LogoProgress>;
type Fetch = Engine['fetchLogos'];

function appWith(parts: Partial<Engine> = {}, jobs: AppOptions['jobs'] = new JobStore()) {
  return createApp({
    engine: stubEngine({ missingLogos: () => [OTHER], fetchLogos: async () => DONE, ...parts }),
    jobs,
    allowedHosts: [HOST],
  });
}

/** Polls a job until it is no longer running. */
async function finished(app: ReturnType<typeof appWith>, jobId: string): Promise<LogoJob> {
  for (let turn = 0; turn < 50; turn += 1) {
    const job = (await read<LogoJob>(await get(app, `/api/jobs/${jobId}`))).data;
    if (job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('the job did not finish');
}

/** A fetch that waits until it is told to stop, as a run in the middle of its list does. */
function untilStopped(asked: string[][] = []): Fetch {
  return async (ids, _report, shouldStop) => {
    asked.push([...ids]);
    while (!shouldStop()) await new Promise((resolve) => setTimeout(resolve, 1));
    return { asked: 1, found: 1, failed: 0, stoppedEarly: true };
  };
}

describe('POST /api/logos', () => {
  test('starts a job for the channels with no stored logo and reports as it goes', async () => {
    const asked: string[][] = [];
    const app = appWith({
      fetchLogos: async (ids, report) => {
        asked.push([...ids]);
        report({ done: 1, total: 1, logos: [{ channelId: OTHER, logoUrl: null }] });
        return DONE;
      },
    });

    const response = await post(app, PATH, { channel: CHANNEL_ID });
    const { data } = await read<{ jobId: string; missing: number }>(response);

    expect(response.status).toBe(202);
    expect(data.missing).toBe(1);
    const job = await finished(app, data.jobId);
    expect(job.status).toBe('done');
    expect(job.result).toEqual(DONE);
    expect(job.progress?.logos).toEqual([{ channelId: OTHER, logoUrl: null }]);
    expect(asked).toEqual([[OTHER]]);
  });

  test('starts nothing when every channel has been read', async () => {
    const app = appWith({ missingLogos: () => [] });

    const response = await post(app, PATH, { channel: CHANNEL_ID });

    expect(response.status).toBe(200);
    expect((await read(response)).data).toEqual({ jobId: null, missing: 0 });
  });

  test('says so when the channel has no map, or is not a channel', async () => {
    const app = appWith({ missingLogos: () => null });

    expect((await post(app, PATH, { channel: CHANNEL_ID })).status).toBe(404);
    expect((await post(app, PATH, { channel: 'not a channel!' })).status).toBe(400);
    expect((await post(app, PATH, {})).status).toBe(400);
    expect((await get(app, PATH)).status).toBe(405);
  });

  test('is refused from another site', async () => {
    const response = await post(
      appWith(),
      PATH,
      { channel: CHANNEL_ID },
      { origin: 'https://elsewhere.example' },
    );

    expect(response.status).toBe(403);
  });

  test('gives the job already running instead of starting a second', async () => {
    const asked: string[][] = [];
    const app = appWith({ fetchLogos: untilStopped(asked) });

    const first = await read<{ jobId: string }>(await post(app, PATH, { channel: CHANNEL_ID }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await post(app, PATH, { channel: CHANNEL_ID });

    expect(second.status).toBe(200);
    expect((await read<{ jobId: string }>(second)).data.jobId).toBe(first.data.jobId);
    expect(asked).toHaveLength(1);
    // Any request for a map ends the job, so the test leaves nothing running.
    await post(app, '/api/maps', { channel: 'not a channel!' });
  });

  test('does not start while a map, a refresh or a search is reading YouTube', async () => {
    const elsewhere = await post(appWith({ isReadingYouTube: () => true }), PATH, {
      channel: CHANNEL_ID,
    });
    const jobs: AppOptions['jobs'] = new JobStore();
    void jobs.hold(() => new Promise(() => {}));
    const here = await post(appWith({}, jobs), PATH, { channel: CHANNEL_ID });

    expect(elsewhere.status).toBe(409);
    expect((await read(elsewhere)).error).toBe(LOGOS_WAIT);
    expect(here.status).toBe(409);
  });

  test('ends quietly when another program takes the lease first', async () => {
    const app = appWith({ fetchLogos: () => Promise.reject(new ReadingElsewhereError()) });

    const { data } = await read<{ jobId: string }>(await post(app, PATH, { channel: CHANNEL_ID }));
    const job = await finished(app, data.jobId);

    expect(job.status).toBe('done');
    expect(job.result).toEqual({ asked: 0, found: 0, failed: 0, stoppedEarly: true });
  });

  test('reports a run that failed outright', async () => {
    const app = appWith({ fetchLogos: () => Promise.reject(new Error('no network')) });

    const { data } = await read<{ jobId: string }>(await post(app, PATH, { channel: CHANNEL_ID }));

    expect((await finished(app, data.jobId)).status).toBe('failed');
  });
});

describe('a logo job under way', () => {
  test('steps aside when a map is asked for, which then starts', async () => {
    const crawls: string[] = [];
    const app = appWith({
      fetchLogos: untilStopped(),
      crawl: async (channel) => {
        crawls.push(channel);
        return { centerChannelId: CHANNEL_ID, warnings: [] };
      },
    });
    const logos = await read<{ jobId: string }>(await post(app, PATH, { channel: CHANNEL_ID }));
    await new Promise((resolve) => setTimeout(resolve, 5));

    const crawl = await post(app, '/api/maps', { channel: CHANNEL_ID });

    expect(crawl.status).toBe(202);
    const job = await finished(app, logos.data.jobId);
    expect(job.result?.stoppedEarly).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(crawls).toEqual([CHANNEL_ID]);
  });
});

describe('logos with the real engine and store', () => {
  const NOW = new Date('2026-11-20T12:00:00Z');
  const cid = (letter: string) => `UC${letter.repeat(22)}`;
  const LOGO = 'https://yt3.googleusercontent.com/logo-of-';
  /** Until `branded` is set the pages carry no branding, as a store made before logos has none. */
  let branded = false;
  let pageOnlyReads = 0;
  const source: YouTubeSource = {
    resolveChannelId: async () => cid('C'),
    fetchChannel: async (channelId, maxVideos) => {
      const letter = channelId.charAt(2);
      if (maxVideos === 0) pageOnlyReads += 1;
      return {
        channel: {
          id: channelId,
          title: `Channel ${letter}`,
          handle: `handle${letter}`,
          subscribers: 1500,
          subscribersHidden: false,
          videoCount: 3,
        },
        videos: [0, 1, 2].map((n) => ({
          id: letter.repeat(10) + String(n),
          channelId,
          title: `America just built machine number ${n}`,
          views: 1000 * (n + 1),
          durationSeconds: 900,
          published: {
            date: new Date(NOW.getTime() - (n + 1) * 86_400_000),
            precision: 'day' as const,
            raw: `${n + 1}d ago`,
          },
        })),
        ...(branded
          ? {
              brand: {
                description: null,
                avatar: [{ url: `${LOGO}${letter}`, width: 88, height: 88 }],
                banner: [],
                keywords: [],
                links: [],
              },
            }
          : {}),
      };
    },
    fetchVideoPage: async () => {
      throw new Error('fetchVideoPage is not used in this test');
    },
    getSidebar: async (videoId) =>
      (videoId.startsWith('C') ? ['A', 'B'] : []).map((letter) => ({
        videoId: letter.repeat(10) + '0',
        title: `Video by ${letter}`,
        channelId: cid(letter),
        channelName: `Channel ${letter}`,
        channelHandle: null,
        views: 1000,
        published: null,
      })),
  };

  test('a map made without logos gains them, one page read per channel, and asks no more', async () => {
    const real = createEngine(
      { dbPath: ':memory:', region: 'US' },
      { createSource: async () => source, now: () => NOW },
    );
    const live = createApp({ engine: real, jobs: new JobStore(), allowedHosts: [HOST] });
    await real.crawl('@handleC', 1, () => {});
    const logosOf = (snapshot: MapSnapshot | null) =>
      [snapshot?.center, ...(snapshot?.channels ?? [])].map((channel) => channel?.logoUrl);
    expect(logosOf(real.findSnapshot(cid('C')))).toEqual([null, null, null]);

    branded = true;
    const started = await post(live, PATH, { channel: cid('C') });
    const { data } = await read<{ jobId: string; missing: number }>(started);
    const job = await finished(live, data.jobId);

    expect(data.missing).toBe(3);
    expect(job.result).toEqual({ asked: 3, found: 3, failed: 0, stoppedEarly: false });
    expect(pageOnlyReads).toBe(3);
    expect(logosOf(real.findSnapshot(cid('C')))).toEqual([`${LOGO}C`, `${LOGO}A`, `${LOGO}B`]);
    expect(real.isReadingYouTube()).toBe(false);
    const again = await read(await post(live, PATH, { channel: cid('C') }));
    expect(again.data).toEqual({ jobId: null, missing: 0 });
    real.close();
  });
});

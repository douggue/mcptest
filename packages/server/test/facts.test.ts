import type { ChannelFacts, NicheList, YouTubeSource } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { createEngine, type RunningEngine } from '../src/engine';
import { JobStore } from '../src/jobs';
import { HOST, get, post, read } from './support';

const DAY_MS = 86_400_000;
const START = new Date('2026-11-18T12:00:00Z');
const CREATED = new Date('2018-03-04T10:00:00Z');
const KEY = 'a-key-of-plausible-length';
const NICHE_ID = `UC${'N'.repeat(22)}`;

/** A small channel whose newest video has taken off, so it lands on the niche list. */
const source: YouTubeSource = {
  resolveChannelId: async () => NICHE_ID,
  getSidebar: async () => [],
  fetchChannel: async (channelId) => ({
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
      views,
      durationSeconds: 900,
      published: {
        date: new Date(START.getTime() - (5 + index * 7) * DAY_MS),
        precision: 'day' as const,
        raw: `${5 + index * 7}d ago`,
      },
    })),
  }),
};

interface World {
  readonly engine: RunningEngine;
  readonly app: (request: Request) => Promise<Response>;
  /** The channel ids of each request for facts. */
  readonly asked: string[][];
  /** Set to make the next request for facts fail. */
  refusal: Error | null;
  now: Date;
}

function world(apiKey: string | undefined): World {
  const made: World = {
    asked: [],
    refusal: null,
    now: START,
    engine: undefined as unknown as RunningEngine,
    app: undefined as unknown as World['app'],
  };
  const engine = createEngine(
    { dbPath: ':memory:', region: 'US', ...(apiKey ? { youtubeApiKey: apiKey } : {}) },
    {
      createSource: async () => source,
      now: () => made.now,
      search: async () => [
        {
          videoId: 'NNNNNNNNN00',
          channelId: NICHE_ID,
          channelTitle: 'Niche channel',
          title: 'How it was built 0',
          publishedAt: START,
        },
      ],
      fetchFacts: async (ids): Promise<readonly ChannelFacts[]> => {
        made.asked.push([...ids]);
        if (made.refusal) throw made.refusal;
        return ids.map((id) => ({
          id,
          createdAt: CREATED,
          country: 'US',
          totalViews: 5_000_000,
          videoCount: 5,
          subscribers: 900,
          subscribersHidden: false,
        }));
      },
    },
  );
  return Object.assign(made, {
    engine,
    app: createApp({ engine, jobs: new JobStore(), allowedHosts: [HOST] }),
  });
}

const firstNiche = async (app: World['app']) =>
  (await read<NicheList>(await get(app, '/api/niches'))).data.channels[0];

describe('channel facts from the official API', () => {
  test('are read after a keyword search, and shown on the niche list', async () => {
    const { app, asked, engine } = world(KEY);

    const response = await post(app, '/api/niches/discover', { keyword: 'how it was built' });

    expect((await read(response)).data).toMatchObject({
      added: 1,
      factsAdded: 1,
      factsProblem: null,
    });
    expect(asked).toEqual([[NICHE_ID]]);
    expect(await firstNiche(app)).toMatchObject({
      id: NICHE_ID,
      createdAt: CREATED.toISOString(),
      country: 'US',
    });
    engine.close();
  });

  test('are never read by opening the page', async () => {
    const { app, asked, engine } = world(KEY);
    await engine.crawl('@niche', 1, () => {});
    engine.setNicheWatched(NICHE_ID, true);

    expect(await firstNiche(app)).toMatchObject({ id: NICHE_ID, createdAt: null, country: null });
    await get(app, '/api/refresh');
    await get(app, `/api/maps/latest?channel=${NICHE_ID}`);

    expect(asked).toEqual([]);
    engine.close();
  });

  test('are read during a refresh for the niche channels that lack them, once', async () => {
    const made = world(KEY);
    await made.engine.crawl('@niche', 1, () => {});
    made.engine.setNicheWatched(NICHE_ID, true);
    made.now = new Date(START.getTime() + 2 * DAY_MS);

    const first = await made.engine.refresh(() => {});
    const second = await made.engine.refresh(() => {});

    expect(first).toMatchObject({ refreshed: 1, factsAdded: 1, factsProblem: null });
    expect(second).toMatchObject({ refreshed: 0, factsAdded: 0, factsProblem: null });
    expect(made.asked).toEqual([[NICHE_ID]]);
    expect((await firstNiche(made.app))?.createdAt).toBe(CREATED.toISOString());
    made.engine.close();
  });

  test('are skipped without a word when no API key is set', async () => {
    const made = world(undefined);
    await made.engine.crawl('@niche', 1, () => {});
    made.engine.setNicheWatched(NICHE_ID, true);
    made.now = new Date(START.getTime() + 2 * DAY_MS);

    const outcome = await made.engine.refresh(() => {});

    expect(outcome).toMatchObject({ refreshed: 1, factsAdded: 0, factsProblem: null });
    expect(made.asked).toEqual([]);
    expect(await firstNiche(made.app)).toMatchObject({ createdAt: null, country: null });
    made.engine.close();
  });

  test('do not fail the refresh or the search when the API refuses, and are asked for again', async () => {
    const made = world(KEY);
    made.refusal = new Error('The YouTube API key has used up its daily allowance.');

    const search = await post(made.app, '/api/niches/discover', { keyword: 'how it was built' });
    made.now = new Date(START.getTime() + 2 * DAY_MS);
    const refreshed = await made.engine.refresh(() => {});
    made.refusal = null;
    const later = await made.engine.refresh(() => {});

    expect(search.status).toBe(200);
    expect((await read(search)).data).toMatchObject({
      added: 1,
      factsAdded: 0,
      factsProblem: 'The YouTube API key has used up its daily allowance.',
    });
    expect(refreshed).toMatchObject({ refreshed: 1, factsAdded: 0 });
    expect(refreshed.factsProblem).toMatch(/daily allowance/);
    expect(later).toMatchObject({ factsAdded: 1, factsProblem: null });
    made.engine.close();
  });

  test('never put the API key in what the server says', async () => {
    const made = world(KEY);
    made.refusal = new Error(`refused at /home/someone/jgtube/x.ts`);

    const search = await post(made.app, '/api/niches/discover', { keyword: 'how it was built' });
    const text = await search.text();

    expect(text).not.toContain(KEY);
    expect(text).not.toContain('/home/someone');
    made.engine.close();
  });
});

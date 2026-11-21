import type {
  CompetitorStatus,
  MapSnapshot,
  NicheList,
  ThumbnailBoard,
  DiscoveryResult,
} from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  CRAWL_MAX_CHANNELS_ASKED,
  CRAWL_MAX_DEPTH,
  CRAWL_MIN_CHANNELS_ASKED,
  type ChannelSnapshot,
  type SidebarItem,
  type YouTubeSource,
} from '@jgtube/core';
import { createApp, type CrawlOutcome, type Engine } from '../src/app';
import { createEngine } from '../src/engine';
import { JobStore } from '../src/jobs';
import { UNUSED_LAB } from './support';

const CHANNEL_ID = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const HOST = '127.0.0.1:4317';

const snapshot = {
  mapId: 7,
  center: { id: CHANNEL_ID, title: 'Centre' },
} as unknown as MapSnapshot;

const board = {
  mapId: 7,
  center: { id: CHANNEL_ID, title: 'Centre', subscribers: null, videos: [] },
  channels: [],
  winnerMinScore: 2,
  ordinaryMaxScore: 1.2,
} satisfies ThumbnailBoard;

const niches = {
  channels: [],
  channelsChecked: 12,
  smallMaxSubscribers: 10_000,
  newMaxAgeDays: 90,
} satisfies NicheList;

class FakeEngine implements Engine {
  listConcepts = UNUSED_LAB.listConcepts;
  setConceptKept = UNUSED_LAB.setConceptKept;
  clearConcepts = UNUSED_LAB.clearConcepts;
  conceptProblem = UNUSED_LAB.conceptProblem;
  makeConcepts = UNUSED_LAB.makeConcepts;
  growConcept = UNUSED_LAB.growConcept;
  whereElse = UNUSED_LAB.whereElse;
  listFormulas = UNUSED_LAB.listFormulas;
  findFormulas = UNUSED_LAB.findFormulas;
  hookLibrary = UNUSED_LAB.hookLibrary;
  buildHookLibrary = UNUSED_LAB.buildHookLibrary;
  labelHooks = UNUSED_LAB.labelHooks;
  findIdeaBrief = UNUSED_LAB.findIdeaBrief;
  findConcept = UNUSED_LAB.findConcept;
  findScriptView = UNUSED_LAB.findScriptView;
  openScript = UNUSED_LAB.openScript;
  scriptChangeProblem = UNUSED_LAB.scriptChangeProblem;
  saveScript = UNUSED_LAB.saveScript;
  stageProblem = UNUSED_LAB.stageProblem;
  runScriptStage = UNUSED_LAB.runScriptStage;
  voiceOf = UNUSED_LAB.voiceOf;
  readVoice = UNUSED_LAB.readVoice;
  findScript = UNUSED_LAB.findScript;
  missingLogos = (): never => {
    throw new Error('not used in these tests');
  };
  fetchLogos = this.missingLogos;
  canReadCountries = (): boolean => false;
  readCountries = this.missingLogos;
  setOwnerPlace = this.missingLogos;
  nicheReads = 0;
  /** The channels the fake store holds, for the watchlist. */
  known: readonly string[] = [CHANNEL_ID];
  watches: Array<[string, boolean]> = [];

  listNiches(): NicheList {
    this.nicheReads += 1;
    return niches;
  }

  hasKey = true;
  searched: string[] = [];
  searchOutcome: Promise<DiscoveryResult> = Promise.resolve({
    keyword: 'new invention',
    videosFound: 50,
    channelsFound: 30,
    added: [CHANNEL_ID],
    alreadyKnown: [],
    failed: [],
  });

  canDiscover(): boolean {
    return this.hasKey;
  }

  isReadingYouTube(): boolean {
    return false;
  }

  analyse(): never {
    throw new Error('not used in these tests');
  }

  watchVideo(): never {
    throw new Error('not used in these tests');
  }

  engineStatus(): never {
    throw new Error('not used in these tests');
  }

  discover(keyword: string): Promise<DiscoveryResult> {
    this.searched.push(keyword);
    return this.searchOutcome;
  }

  listTransfers(): never {
    throw new Error('not used in these tests');
  }

  setTransferSaved(): never {
    throw new Error('not used in these tests');
  }

  setNicheWatched(channel: string, watched: boolean): boolean {
    if (!this.known.includes(channel)) return false;
    this.watches.push([channel, watched]);
    return true;
  }

  stored: MapSnapshot | null = snapshot;
  lookups: string[] = [];
  board: ThumbnailBoard | null = board;
  boardLookups: string[] = [];

  findThumbnailBoard(channel: string): ThumbnailBoard | null {
    this.boardLookups.push(channel);
    return this.board;
  }

  findSameTopic(): null {
    return null;
  }

  refresh(): never {
    throw new Error('not used in these tests');
  }

  refreshStatus(): never {
    throw new Error('not used in these tests');
  }
  crawls: Array<{ channel: string; depth: number }> = [];
  outcome: Promise<CrawlOutcome> = Promise.resolve({ centerChannelId: CHANNEL_ID, warnings: [] });

  findSnapshot(channel: string): MapSnapshot | null {
    this.lookups.push(channel);
    return this.stored;
  }

  saved: ReturnType<Engine['listSavedChannels']> = [];
  deleted: string[] = [];

  deleteSavedChannel(channelId: string): boolean {
    this.deleted.push(channelId);
    return this.saved.some((channel) => channel.id === channelId);
  }

  listSavedChannels(): ReturnType<Engine['listSavedChannels']> {
    return this.saved;
  }

  choices: Parameters<Engine['crawl']>[3];

  crawl(
    channel: string,
    depth: number,
    onProgress: Parameters<Engine['crawl']>[2],
    choices?: Parameters<Engine['crawl']>[3],
  ) {
    this.crawls.push({ channel, depth });
    this.choices = choices;
    onProgress({ stage: 'reading-channels', channels: 3, step: 1 });
    return this.outcome;
  }

  statuses: Array<[string, string, string]> = [];

  setCompetitorStatus(center: string, channel: string, status: CompetitorStatus): boolean {
    if (this.stored === null) return false;
    this.statuses.push([center, channel, status]);
    return true;
  }

  breakDown(): never {
    throw new Error('breakDown is not used in this test');
  }

  ownVideosFolder(): never {
    throw new Error('ownVideosFolder is not used in this test');
  }

  saveTranscripts(): never {
    throw new Error('saveTranscripts is not used in this test');
  }

  findVideoStudy(): never {
    throw new Error('findVideoStudy is not used in this test');
  }

  findBreakdown(): never {
    throw new Error('findBreakdown is not used in this test');
  }

  breakdownText(): never {
    throw new Error('breakdownText is not used in this test');
  }

  findVideoSeconds(): never {
    throw new Error('findVideoSeconds is not used in this test');
  }

  findBreakdownPart(): never {
    throw new Error('findBreakdownPart is not used in this test');
  }

  saveThumbnails(): never {
    throw new Error('not used in these tests');
  }

  readTranscript(): never {
    throw new Error('not used in these tests');
  }

  readVideoFrames(): never {
    throw new Error('not used in these tests');
  }

  readChannelBrand(): never {
    throw new Error('not used in these tests');
  }

  readVideoDetails(): never {
    throw new Error('not used in these tests');
  }
}

let engine: FakeEngine;
let app: (request: Request) => Promise<Response>;

beforeEach(() => {
  engine = new FakeEngine();
  let next = 0;
  app = createApp({
    engine,
    jobs: new JobStore(() => `job-${(next += 1)}`),
    allowedHosts: [HOST],
  });
});

const get = (path: string) =>
  app(new Request(`http://${HOST}${path}`, { headers: { host: HOST } }));

const post = (body: unknown, headers: Record<string, string> = {}) =>
  app(
    new Request(`http://${HOST}/api/maps`, {
      method: 'POST',
      headers: { host: HOST, 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('GET /api/maps/latest', () => {
  test('returns the stored map in the standard envelope', async () => {
    const response = await get('/api/maps/latest?channel=%40veritasium');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    expect(await response.json()).toEqual({
      success: true,
      data: snapshot,
      error: null,
      meta: null,
    });
    expect(engine.lookups).toEqual(['@veritasium']);
  });

  test('answers 404 when no map has been crawled for the channel', async () => {
    engine.stored = null;

    const response = await get(`/api/maps/latest?channel=${CHANNEL_ID}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, data: null });
  });

  test.each(['', 'https%3A%2F%2Fevil.example%2F%40x', 'a%20b'])(
    'rejects the channel %j without touching the store',
    async (channel) => {
      const response = await get(`/api/maps/latest?channel=${channel}`);

      expect(response.status).toBe(400);
      expect(engine.lookups).toEqual([]);
    },
  );
});

describe('GET /api/maps', () => {
  test('lists the channels a map has been made for', async () => {
    engine.saved = [
      {
        id: CHANNEL_ID,
        title: 'Veritasium',
        handle: 'veritasium',
        subscribers: 1200,
        logoUrl: null,
        mapMadeAt: '2026-11-20T12:00:00.000Z',
        channelCount: 21,
      },
    ];

    const response = await get('/api/maps');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { channels: engine.saved },
    });
  });
});

describe('POST /api/maps/delete', () => {
  const send = (body: unknown) =>
    app(
      new Request(`http://${HOST}/api/maps/delete`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  const savedChannel = {
    id: CHANNEL_ID,
    title: 'Veritasium',
    handle: 'veritasium',
    subscribers: 1200,
    logoUrl: null,
    mapMadeAt: '2026-11-20T12:00:00.000Z',
    channelCount: 21,
  };

  test('deletes the maps of a saved channel', async () => {
    engine.saved = [savedChannel];

    const response = await send({ channel: CHANNEL_ID });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { channel: CHANNEL_ID } });
    expect(engine.deleted).toEqual([CHANNEL_ID]);
  });

  test('answers 404 for a channel with no map, and 400 for anything that is not a channel id', async () => {
    expect((await send({ channel: CHANNEL_ID })).status).toBe(404);
    expect((await send({ channel: '@veritasium' })).status).toBe(400);
    expect((await send({})).status).toBe(400);
    expect(engine.deleted).toEqual([CHANNEL_ID]);
  });

  test('waits while a map is being made', async () => {
    engine.saved = [savedChannel];
    engine.outcome = new Promise(() => {});
    await app(
      new Request(`http://${HOST}/api/maps`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json' },
        body: JSON.stringify({ channel: CHANNEL_ID }),
      }),
    );

    const response = await send({ channel: CHANNEL_ID });

    expect(response.status).toBe(409);
    expect(engine.deleted).toEqual([]);
  });
});

describe('GET /api/maps/latest/thumbnails', () => {
  const PATH = '/api/maps/latest/thumbnails';

  test('returns the thumbnail board in the standard envelope', async () => {
    const response = await get(`${PATH}?channel=%40veritasium`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    expect(await response.json()).toEqual({ success: true, data: board, error: null, meta: null });
    expect(engine.boardLookups).toEqual(['@veritasium']);
  });

  test('answers 404 when no map has been made for the channel', async () => {
    engine.board = null;

    const response = await get(`${PATH}?channel=${CHANNEL_ID}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, data: null });
  });

  test.each(['', 'https%3A%2F%2Fevil.example%2F%40x', 'a%20b'])(
    'rejects the channel %j without touching the store',
    async (channel) => {
      const response = await get(`${PATH}?channel=${channel}`);

      expect(response.status).toBe(400);
      expect(engine.boardLookups).toEqual([]);
    },
  );

  test('only answers to GET', async () => {
    const response = await app(
      new Request(`http://${HOST}${PATH}?channel=${CHANNEL_ID}`, {
        method: 'POST',
        headers: { host: HOST },
      }),
    );

    expect(response.status).toBe(405);
    expect(engine.boardLookups).toEqual([]);
  });

  test('is refused to a page that names another host', async () => {
    const response = await app(
      new Request(`http://evil.example:4317${PATH}?channel=${CHANNEL_ID}`, {
        headers: { host: 'evil.example:4317' },
      }),
    );

    expect(response.status).toBe(403);
    expect(engine.boardLookups).toEqual([]);
  });
});

describe('POST /api/maps', () => {
  test('starts a crawl and reports the job so it can be polled', async () => {
    const response = await post({ channel: '@veritasium', depth: 1 });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ success: true, data: { jobId: 'job-1' } });
    expect(engine.crawls).toEqual([{ channel: '@veritasium', depth: 1 }]);
  });

  test('defaults to two steps', async () => {
    await post({ channel: '@veritasium' });

    expect(engine.crawls[0]?.depth).toBe(2);
  });

  test('refuses a second crawl while one is running', async () => {
    engine.outcome = new Promise(() => {});
    await post({ channel: '@veritasium' });

    const second = await post({ channel: '@veritasium' });

    expect(second.status).toBe(409);
    expect(engine.crawls).toHaveLength(1);
  });

  test('takes its limits on depth and size from the engine, not from a copy of them', async () => {
    const most = { depth: CRAWL_MAX_DEPTH, maxChannels: CRAWL_MAX_CHANNELS_ASKED };

    expect((await post({ channel: '@veritasium', ...most })).status).toBe(202);
    await settle();
    for (const tooMuch of [
      { depth: CRAWL_MAX_DEPTH + 1 },
      { maxChannels: CRAWL_MAX_CHANNELS_ASKED + 1 },
      { maxChannels: CRAWL_MIN_CHANNELS_ASKED - 1 },
    ]) {
      const response = await post({ channel: '@veritasium', ...tooMuch });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain(
        `a depth of 1 to ${CRAWL_MAX_DEPTH} and a size of ${CRAWL_MIN_CHANNELS_ASKED} to ${CRAWL_MAX_CHANNELS_ASKED} channels`,
      );
    }
    expect(engine.crawls).toEqual([{ channel: '@veritasium', depth: CRAWL_MAX_DEPTH }]);
  });

  test('passes a deeper, larger crawl through to the engine', async () => {
    const response = await post({ channel: '@veritasium', depth: 3, maxChannels: 300 });
    await settle();

    expect(response.status).toBe(202);
    expect(engine.crawls).toEqual([{ channel: '@veritasium', depth: 3 }]);
    expect(engine.choices).toMatchObject({ maxChannels: 300 });
  });

  test.each([
    [{ channel: 'https://evil.example/@x' }, 'a host that is not YouTube'],
    [{ channel: '@veritasium', depth: 4 }, 'a depth that is not supported'],
    [{ channel: '@veritasium', maxChannels: 5000 }, 'a size that is not supported'],
    [{}, 'a missing channel'],
    ['{not json', 'a body that is not JSON'],
    [{ channel: 'x'.repeat(5000) }, 'an oversized body'],
  ])('rejects %j (%s)', async (body, _reason) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(engine.crawls).toEqual([]);
  });

  test('rejects requests sent from another site', async () => {
    const response = await post({ channel: '@veritasium' }, { origin: 'https://evil.example' });

    expect(response.status).toBe(403);
    expect(engine.crawls).toEqual([]);
  });

  test('accepts requests from its own origin', async () => {
    const response = await post({ channel: '@veritasium' }, { origin: `http://${HOST}` });

    expect(response.status).toBe(202);
  });

  test('requires a JSON content type', async () => {
    const response = await post({ channel: '@veritasium' }, { 'content-type': 'text/plain' });

    expect(response.status).toBe(415);
  });
});

describe('GET /api/jobs/:id', () => {
  test('shows progress and then the outcome of a crawl', async () => {
    await post({ channel: '@veritasium' });
    await settle();

    const response = await get('/api/jobs/job-1');

    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        status: 'done',
        progress: { stage: 'reading-channels', channels: 3 },
        result: { centerChannelId: CHANNEL_ID, warnings: [] },
      },
    });
  });

  test('reports a failed crawl without failing the request', async () => {
    engine.outcome = Promise.reject(new Error('No YouTube channel found'));
    await post({ channel: '@veritasium' });
    await settle();

    const body = await (await get('/api/jobs/job-1')).json();

    expect(body).toMatchObject({ data: { status: 'failed', error: 'No YouTube channel found' } });
  });

  test('answers 404 for a job it does not know', async () => {
    expect((await get('/api/jobs/missing')).status).toBe(404);
  });
});

describe('other requests', () => {
  test('answers 404 for unknown API paths', async () => {
    expect((await get('/api/nope')).status).toBe(404);
  });

  test('answers 405 for a method a route does not accept', async () => {
    const response = await app(
      new Request(`http://${HOST}/api/maps/latest?channel=x`, {
        method: 'DELETE',
        headers: { host: HOST },
      }),
    );

    expect(response.status).toBe(405);
  });

  test('never lets responses be cached or sniffed', async () => {
    const response = await get(`/api/maps/latest?channel=${CHANNEL_ID}`);

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('requests that name another host', () => {
  const asHost = (host: string, init: RequestInit = {}) =>
    app(
      new Request(`http://${host}/api/maps/latest?channel=${CHANNEL_ID}`, {
        ...init,
        headers: { host, ...(init.headers as Record<string, string> | undefined) },
      }),
    );

  test('are refused even when the page looks same-origin to the browser', async () => {
    const response = await asHost('evil.example:4317', {
      headers: { origin: 'http://evil.example:4317' },
    });

    expect(response.status).toBe(403);
    expect(engine.lookups).toEqual([]);
  });

  test('are refused when no host is given at all', async () => {
    const response = await app(new Request(`http://${HOST}/api/jobs/job-1`));

    expect(response.status).toBe(403);
  });

  test('cannot start a crawl by echoing their own name as the origin', async () => {
    const response = await app(
      new Request('http://evil.example:4317/api/maps', {
        method: 'POST',
        headers: {
          host: 'evil.example:4317',
          origin: 'http://evil.example:4317',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ channel: '@veritasium' }),
      }),
    );

    expect(response.status).toBe(403);
    expect(engine.crawls).toEqual([]);
  });
});

describe('POST /api/competitors', () => {
  const OTHER = 'UCMOqf8ab-42UUQIdVoKwjlQ';
  const send = (body: unknown, headers: Record<string, string> = {}) =>
    app(
      new Request(`http://${HOST}/api/competitors`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    );

  test('removes a channel, keeps one, and puts either back to the filter’s own answer', async () => {
    const removed = await send({ center: CHANNEL_ID, channel: OTHER, status: 'removed' });
    await send({ center: CHANNEL_ID, channel: OTHER, status: 'kept' });
    await send({ center: CHANNEL_ID, channel: OTHER, status: 'auto' });

    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      success: true,
      data: { center: CHANNEL_ID, channel: OTHER, status: 'removed' },
      error: null,
      meta: null,
    });
    expect(engine.statuses).toEqual([
      [CHANNEL_ID, OTHER, 'removed'],
      [CHANNEL_ID, OTHER, 'kept'],
      [CHANNEL_ID, OTHER, 'auto'],
    ]);
  });

  test('answers 404 when the centre channel has no map', async () => {
    engine.stored = null;

    expect((await send({ center: CHANNEL_ID, channel: OTHER, status: 'kept' })).status).toBe(404);
  });

  test.each([
    [{ center: 'not-an-id', channel: OTHER, status: 'kept' }],
    [{ center: CHANNEL_ID, channel: '@handle', status: 'kept' }],
    [{ center: CHANNEL_ID, channel: OTHER, status: 'yes' }],
    [{ center: CHANNEL_ID, channel: OTHER, removed: true }],
    [{ center: CHANNEL_ID, channel: OTHER, status: true }],
    [{ center: CHANNEL_ID }],
  ])('rejects %j', async (body) => {
    expect((await send(body)).status).toBe(400);
    expect(engine.statuses).toEqual([]);
  });

  test('rejects requests sent from another site', async () => {
    const response = await send(
      { center: CHANNEL_ID, channel: OTHER, status: 'kept' },
      { origin: 'https://evil.example' },
    );

    expect(response.status).toBe(403);
    expect(engine.statuses).toEqual([]);
  });
});

describe('GET /api/niches', () => {
  test('returns the niche list in the standard envelope', async () => {
    const response = await get('/api/niches');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { ...niches, canDiscover: true },
      error: null,
      meta: null,
    });
    expect(engine.nicheReads).toBe(1);
  });

  test('only answers to GET', async () => {
    const response = await app(
      new Request(`http://${HOST}/api/niches`, { method: 'POST', headers: { host: HOST } }),
    );

    expect(response.status).toBe(405);
    expect(engine.nicheReads).toBe(0);
  });

  test('is refused to a page that names another host', async () => {
    const response = await app(
      new Request('http://evil.example/api/niches', { headers: { host: 'evil.example' } }),
    );

    expect(response.status).toBe(403);
    expect(engine.nicheReads).toBe(0);
  });
});

describe('POST /api/niches/watch', () => {
  const OTHER = 'UCMOqf8ab-42UUQIdVoKwjlQ';
  const send = (body: unknown, headers: Record<string, string> = {}) =>
    app(
      new Request(`http://${HOST}/api/niches/watch`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );

  test('marks a channel as watched and can unmark it', async () => {
    const watched = await send({ channel: CHANNEL_ID, watched: true });
    await send({ channel: CHANNEL_ID, watched: false });

    expect(watched.status).toBe(200);
    expect(await watched.json()).toEqual({
      success: true,
      data: { channel: CHANNEL_ID, watched: true },
      error: null,
      meta: null,
    });
    expect(engine.watches).toEqual([
      [CHANNEL_ID, true],
      [CHANNEL_ID, false],
    ]);
  });

  test('answers 404 for a channel that is not in the store', async () => {
    const response = await send({ channel: OTHER, watched: true });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, data: null });
  });

  test.each([
    [{ channel: 'not-an-id', watched: true }],
    [{ channel: '@handle', watched: true }],
    [{ channel: CHANNEL_ID, watched: 'yes' }],
    [{ channel: CHANNEL_ID }],
    [{ watched: true }],
    ['{not json'],
  ])('rejects %j', async (body) => {
    expect((await send(body)).status).toBe(400);
    expect(engine.watches).toEqual([]);
  });

  test('rejects a body that is too large', async () => {
    const response = await send({ channel: CHANNEL_ID, watched: true, padding: 'x'.repeat(3000) });

    expect(response.status).toBe(400);
    expect(engine.watches).toEqual([]);
  });

  test('rejects requests sent from another site', async () => {
    const response = await send(
      { channel: CHANNEL_ID, watched: true },
      { origin: 'https://evil.example' },
    );

    expect(response.status).toBe(403);
    expect(engine.watches).toEqual([]);
  });

  test('requires a JSON content type', async () => {
    const response = await send(
      { channel: CHANNEL_ID, watched: true },
      {
        'content-type': 'text/plain',
      },
    );

    expect(response.status).toBe(415);
    expect(engine.watches).toEqual([]);
  });

  test('only answers to POST', async () => {
    expect((await get('/api/niches/watch')).status).toBe(405);
  });

  test('is refused to a page that names another host', async () => {
    const response = await app(
      new Request('http://evil.example/api/niches/watch', {
        method: 'POST',
        headers: { host: 'evil.example', 'content-type': 'application/json' },
        body: JSON.stringify({ channel: CHANNEL_ID, watched: true }),
      }),
    );

    expect(response.status).toBe(403);
    expect(engine.watches).toEqual([]);
  });
});

describe('the server, the store and the engine together', () => {
  const NOW = new Date('2026-11-20T12:00:00Z');
  const cid = (letter: string) => `UC${letter.repeat(22)}`;
  const vid = (letter: string, n: number) => letter.repeat(10) + String(n);
  const links: Record<string, readonly string[]> = { C: ['A', 'B'], A: ['D'] };

  const source: YouTubeSource = {
    resolveChannelId: async () => cid('C'),
    fetchChannel: async (channelId): Promise<ChannelSnapshot> => {
      const letter = channelId.charAt(2);
      return {
        channel: {
          id: channelId,
          title: `Channel ${letter}`,
          handle: `handle${letter}`,
          subscribers: 1000,
          subscribersHidden: false,
          videoCount: 2,
        },
        videos: [1, 2].map((n) => ({
          id: vid(letter, n),
          channelId,
          title: `America Just Built Thing ${n}`,
          views: 1000 * n,
          durationSeconds: 900,
          published: {
            date: new Date(NOW.getTime() - n * 86_400_000),
            precision: 'day',
            raw: `${n}d ago`,
          },
        })),
      };
    },
    fetchVideoPage: async () => {
      throw new Error('fetchVideoPage is not used in this test');
    },
    getSidebar: async (videoId): Promise<readonly SidebarItem[]> =>
      (links[videoId.charAt(0)] ?? []).map((letter) => ({
        videoId: vid(letter, 0),
        title: `Video by ${letter}`,
        channelId: cid(letter),
        channelName: `Channel ${letter}`,
        channelHandle: null,
        views: 1000,
        published: null,
      })),
  };

  test('a map seeded with a model channel includes it and says so', async () => {
    const real = createEngine(
      { dbPath: ':memory:', region: 'US' },
      { createSource: async () => source, now: () => NOW },
    );
    const live = createApp({ engine: real, jobs: new JobStore(), allowedHosts: [HOST] });
    const post = (body: unknown) =>
      live(
        new Request(`http://${HOST}/api/maps`, {
          method: 'POST',
          headers: { host: HOST, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );

    const refused = await post({ channel: '@handleC', model: 'not a channel!' });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toMatch(/^Model channel: /);
    expect((await post({ channel: '@handleC', model: cid('E') })).status).toBe(202);
    let map = real.findSnapshot(cid('C'));
    for (let tries = 0; map === null && tries < 50; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      map = real.findSnapshot(cid('C'));
    }

    expect(map?.model).toEqual({ id: cid('E'), title: 'Channel E' });
    expect(map?.channels.map((c) => c.title)).toContain('Channel E');
    real.close();
  });

  /** The fields this test reads from any of the API's answers. */
  interface Reply {
    readonly jobId: string;
    readonly status: string;
    readonly channels: ReadonlyArray<{
      readonly title: string;
      readonly removed: boolean;
      readonly kept: boolean;
    }>;
  }

  test('make a map, read it back, then remove, keep and reset a competitor', async () => {
    const real = createEngine(
      { dbPath: ':memory:', region: 'US' },
      { createSource: async () => source, now: () => NOW },
    );
    const live = createApp({ engine: real, jobs: new JobStore(), allowedHosts: [HOST] });
    const call = (path: string, body?: unknown) =>
      live(
        new Request(`http://${HOST}${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { host: HOST, ...(body ? { 'content-type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        }),
      ).then((response) => response.json() as Promise<{ data: Reply }>);

    const { data: started } = await call('/api/maps', { channel: '@handleC' });
    let job = (await call(`/api/jobs/${started.jobId}`)).data;
    for (let tries = 0; job.status === 'running' && tries < 50; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      job = (await call(`/api/jobs/${started.jobId}`)).data;
    }
    expect(job).toMatchObject({ status: 'done', result: { centerChannelId: cid('C') } });

    const { data: map } = await call('/api/maps/latest?channel=%40handleC');
    expect(map.channels.map((c) => c.title).sort()).toEqual([
      'Channel A',
      'Channel B',
      'Channel D',
    ]);

    const refuse = async (channel: string) =>
      (
        await live(
          new Request(`http://${HOST}/api/competitors`, {
            method: 'POST',
            headers: { host: HOST, 'content-type': 'application/json' },
            body: JSON.stringify({ center: cid('C'), channel, status: 'kept' }),
          }),
        )
      ).status;
    expect(await refuse(cid('Z'))).toBe(404);
    expect(await refuse(cid('C'))).toBe(404);

    await call('/api/competitors', { center: cid('C'), channel: cid('A'), status: 'removed' });
    const { data: after } = await call(`/api/maps/latest?channel=${cid('C')}`);
    const removed = after.channels.filter((c) => c.removed);
    expect(removed.map((c) => c.title)).toEqual(['Channel A']);

    const choiceOn = async (title: string) => {
      const { data } = await call(`/api/maps/latest?channel=${cid('C')}`);
      const found = data.channels.find((c) => c.title === title);
      return [found?.removed, found?.kept];
    };
    await call('/api/competitors', { center: cid('C'), channel: cid('A'), status: 'kept' });
    expect(await choiceOn('Channel A')).toEqual([false, true]);
    await call('/api/competitors', { center: cid('C'), channel: cid('A'), status: 'removed' });
    expect(await choiceOn('Channel A')).toEqual([true, false]);
    await call('/api/competitors', { center: cid('C'), channel: cid('A'), status: 'auto' });
    expect(await choiceOn('Channel A')).toEqual([false, false]);
    real.close();
  });

  test('make a map and read its thumbnail board, less a removed competitor', async () => {
    const USUAL_VIEWS = 1000;
    /** Seven videos old enough to judge: two far above the channel's usual, five at it. */
    const views = [USUAL_VIEWS * 30, USUAL_VIEWS * 8, ...Array<number>(5).fill(USUAL_VIEWS)];
    const withHits: YouTubeSource = {
      ...source,
      fetchChannel: async (channelId, maxVideos) => {
        const snapshot = await source.fetchChannel(channelId, maxVideos);
        const letter = channelId.charAt(2);
        return {
          ...snapshot,
          videos: views.map((count, index) => ({
            id: vid(letter, index),
            channelId,
            title: `America Just Built Thing ${index}`,
            views: count,
            durationSeconds: 900,
            published: {
              date: new Date(NOW.getTime() - (index + 10) * 86_400_000),
              precision: 'day' as const,
              raw: `${index + 10}d ago`,
            },
          })),
        };
      },
    };
    const real = createEngine(
      { dbPath: ':memory:', region: 'US' },
      { createSource: async () => withHits, now: () => NOW },
    );
    const live = createApp({ engine: real, jobs: new JobStore(), allowedHosts: [HOST] });
    const call = (path: string, body?: unknown) =>
      live(
        new Request(`http://${HOST}${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { host: HOST, ...(body ? { 'content-type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        }),
      );
    const readBoard = async (channel: string) =>
      (
        (await (await call(`/api/maps/latest/thumbnails?channel=${channel}`)).json()) as {
          data: ThumbnailBoard;
        }
      ).data;

    expect((await call(`/api/maps/latest/thumbnails?channel=${cid('C')}`)).status).toBe(404);
    await call('/api/maps', { channel: '@handleC' });
    for (let tries = 0; real.findSnapshot(cid('C')) === null && tries < 50; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const found = await readBoard('%40handleC');
    expect(found.center).toMatchObject({ id: cid('C'), title: 'Channel C', subscribers: 1000 });
    expect(found.center.videos.map((video) => video.videoId)).toEqual(
      views.slice(0, 6).map((_, index) => vid('C', index)),
    );
    expect(found.channels.map((channel) => channel.title).sort()).toEqual([
      'Channel A',
      'Channel B',
      'Channel D',
    ]);
    for (const channel of found.channels) {
      expect(channel.winners.map((video) => video.videoId)).toEqual([
        vid(channel.id.charAt(2), 0),
        vid(channel.id.charAt(2), 1),
      ]);
      expect(channel.ordinary).toHaveLength(5);
      expect(channel).toMatchObject({ subscribers: 1000, winnerCount: 2, scoredCount: 7 });
    }
    expect(found.channels[0]?.winners[0]).toMatchObject({
      title: 'America Just Built Thing 0',
      views: 30_000,
      publishedRaw: '10d ago',
    });

    await call('/api/competitors', { center: cid('C'), channel: cid('A'), status: 'removed' });
    const after = await readBoard(cid('C'));
    expect(after.channels.map((channel) => channel.title).sort()).toEqual([
      'Channel B',
      'Channel D',
    ]);
    real.close();
  });

  test('find the new channels with a video that took off, watch one and see it stay watched', async () => {
    /** Two videos far above the channel's usual and four at it, all under 40 days old. */
    const views = [40_000, 30_000, 1000, 1000, 1000, 1000];
    const rising: YouTubeSource = {
      ...source,
      fetchChannel: async (channelId, maxVideos) => {
        const snapshot = await source.fetchChannel(channelId, maxVideos);
        const letter = channelId.charAt(2);
        return {
          ...snapshot,
          videos: views.map((count, index) => ({
            id: vid(letter, index),
            channelId,
            title: `America Just Built Thing ${index}`,
            views: count,
            durationSeconds: 900,
            published: {
              date: new Date(NOW.getTime() - (index + 1) * 5 * 86_400_000),
              precision: 'day' as const,
              raw: `${(index + 1) * 5}d ago`,
            },
          })),
        };
      },
    };
    const real = createEngine(
      { dbPath: ':memory:', region: 'US' },
      { createSource: async () => rising, now: () => NOW },
    );
    const live = createApp({ engine: real, jobs: new JobStore(), allowedHosts: [HOST] });
    const call = (path: string, body?: unknown) =>
      live(
        new Request(`http://${HOST}${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { host: HOST, ...(body ? { 'content-type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        }),
      );
    const readNiches = async () =>
      ((await (await call('/api/niches')).json()) as { data: NicheList }).data;

    expect(await readNiches()).toMatchObject({ channels: [], channelsChecked: 0 });
    await call('/api/maps', { channel: '@handleC' });
    for (let tries = 0; real.findSnapshot(cid('C')) === null && tries < 50; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const found = await readNiches();
    expect(found.channelsChecked).toBe(4);
    // The centre is the owner's own channel: never offered as a niche.
    expect(found.channels.map((entry) => entry.title)).toEqual([
      'Channel A',
      'Channel B',
      'Channel D',
    ]);
    expect(found.channels[0]).toMatchObject({
      id: cid('A'),
      handle: 'handleA',
      subscribers: 1000,
      recentViews: 74_000,
      recentUploads: 6,
      viewsPerSubscriber: 74,
      channelAgeDays: 30,
      reasons: ['new', 'small'],
      hitCount: 2,
      scoredCount: 6,
      qualifies: true,
      watched: false,
    });
    expect(found.channels[0]?.outperformers.map((video) => video.videoId)).toEqual([
      vid('A', 0),
      vid('A', 1),
    ]);
    expect(found.channels[0]?.sampleTitles[0]).toEqual({
      videoId: vid('A', 0),
      title: 'America Just Built Thing 0',
      views: 40_000,
    });

    expect((await call('/api/niches/watch', { channel: cid('Z'), watched: true })).status).toBe(
      404,
    );
    expect((await call('/api/niches/watch', { channel: cid('B'), watched: true })).status).toBe(
      200,
    );
    const watched = (await readNiches()).channels.filter((entry) => entry.watched);
    expect(watched.map((entry) => entry.title)).toEqual(['Channel B']);

    await call('/api/niches/watch', { channel: cid('B'), watched: false });
    expect((await readNiches()).channels.filter((entry) => entry.watched)).toEqual([]);
    real.close();
  });
});

describe('POST /api/niches/discover', () => {
  const send = (body: unknown, headers: Record<string, string> = {}) =>
    app(
      new Request(`http://${HOST}/api/niches/discover`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    );

  test('searches for the keyword and reports what was found as counts', async () => {
    const response = await send({ keyword: '  new invention ' });

    expect(response.status).toBe(200);
    expect(engine.searched).toEqual(['new invention']);
    expect(((await response.json()) as { data: unknown }).data).toEqual({
      keyword: 'new invention',
      videosFound: 50,
      channelsFound: 30,
      added: 1,
      alreadyKnown: 0,
      failed: 0,
      factsAdded: 0,
      factsProblem: null,
    });
  });

  test('explains that a key is needed when none is set', async () => {
    engine.hasKey = false;

    const response = await send({ keyword: 'new invention' });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/YOUTUBE_API_KEY/);
    expect(engine.searched).toEqual([]);
  });

  test.each([[{}], [{ keyword: '   ' }], [{ keyword: 'x'.repeat(201) }], [{ keyword: 5 }]])(
    'rejects %j',
    async (body) => {
      expect((await send(body)).status).toBe(400);
      expect(engine.searched).toEqual([]);
    },
  );

  test('runs one search at a time', async () => {
    let finish: (result: DiscoveryResult) => void = () => {};
    engine.searchOutcome = new Promise((resolve) => {
      finish = resolve;
    });

    const first = send({ keyword: 'one' });
    await settle();
    const second = await send({ keyword: 'two' });
    finish({
      keyword: 'one',
      videosFound: 0,
      channelsFound: 0,
      added: [],
      alreadyKnown: [],
      failed: [],
    });

    expect(second.status).toBe(409);
    expect((await first).status).toBe(200);
    expect((await send({ keyword: 'three' })).status).toBe(200);
  });

  test('is refused while a map is being made, and runs once the map is done', async () => {
    let finishCrawl: (outcome: CrawlOutcome) => void = () => {};
    engine.outcome = new Promise((resolve) => {
      finishCrawl = resolve;
    });
    await post({ channel: CHANNEL_ID });
    await settle();

    const refused = await send({ keyword: 'one' });
    finishCrawl({ centerChannelId: CHANNEL_ID, warnings: [] });
    await settle();
    const allowed = await send({ keyword: 'two' });

    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/already running/);
    expect(allowed.status).toBe(200);
    expect(engine.searched).toEqual(['two']);
  });

  test('holds off a new map and a refresh until the search is done', async () => {
    let finish: (result: DiscoveryResult) => void = () => {};
    engine.searchOutcome = new Promise((resolve) => {
      finish = resolve;
    });
    const search = send({ keyword: 'one' });
    await settle();

    const map = await post({ channel: CHANNEL_ID });
    const refresh = await app(
      new Request(`http://${HOST}/api/refresh`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    finish({
      keyword: 'one',
      videosFound: 0,
      channelsFound: 0,
      added: [],
      alreadyKnown: [],
      failed: [],
    });

    expect(map.status).toBe(409);
    expect(refresh.status).toBe(409);
    expect(engine.crawls).toEqual([]);
    expect((await search).status).toBe(200);
    expect((await post({ channel: CHANNEL_ID })).status).toBe(202);
  });

  test('lets other work start again after a search that failed', async () => {
    engine.searchOutcome = Promise.reject(new Error('quota gone'));

    expect((await send({ keyword: 'one' })).status).toBe(502);

    expect((await post({ channel: CHANNEL_ID })).status).toBe(202);
  });

  test('reports a search that fails without leaking where files live', async () => {
    engine.searchOutcome = Promise.reject(new Error('quota gone at /home/someone/jgtube/x.ts'));

    const response = await send({ keyword: 'new invention' });

    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).not.toContain('/home/someone');
  });

  test('rejects requests sent from another site, and anything but POST', async () => {
    expect((await send({ keyword: 'x' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await get('/api/niches/discover')).status).toBe(405);
  });

  test('with the real engine, reads the channels a search finds into the store', async () => {
    const letterOf = (id: string) => id.charAt(2);
    const real = createEngine(
      { dbPath: ':memory:', region: 'US', youtubeApiKey: 'a-key-of-plausible-length' },
      {
        now: () => new Date('2026-11-20T12:00:00Z'),
        search: async () => [
          {
            videoId: 'QQQQQQQQQQ1',
            channelId: `UC${'Q'.repeat(22)}`,
            channelTitle: 'Channel Q',
            title: 'A video',
            publishedAt: new Date('2026-11-01T00:00:00Z'),
          },
        ],
        createSource: async () => ({
          resolveChannelId: async () => `UC${'Q'.repeat(22)}`,
          fetchVideoPage: async () => {
            throw new Error('fetchVideoPage is not used in this test');
          },
          getSidebar: async () => [],
          fetchChannel: async (channelId) => ({
            channel: {
              id: channelId,
              title: `Channel ${letterOf(channelId)}`,
              handle: null,
              subscribers: 800,
              subscribersHidden: false,
              videoCount: 1,
            },
            videos: [
              {
                id: 'QQQQQQQQQQ1',
                channelId,
                title: 'A video',
                views: 5000,
                durationSeconds: 600,
                published: {
                  date: new Date('2026-11-01T00:00:00Z'),
                  precision: 'day',
                  raw: '19d ago',
                },
              },
            ],
          }),
        }),
      },
    );
    const live = createApp({ engine: real, jobs: new JobStore(), allowedHosts: [HOST] });

    const response = await live(
      new Request(`http://${HOST}/api/niches/discover`, {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json' },
        body: JSON.stringify({ keyword: 'new invention' }),
      }),
    );

    expect(((await response.json()) as { data: { added: number } }).data.added).toBe(1);
    expect(real.listNiches().channelsChecked).toBe(1);
    expect(real.canDiscover()).toBe(true);
    real.close();
  });
});

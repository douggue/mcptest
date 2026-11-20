import type { MapSnapshot } from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp, type CrawlOutcome, type Engine } from '../src/app';
import { JobStore } from '../src/jobs';

const CHANNEL_ID = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const HOST = '127.0.0.1:4317';

const snapshot = {
  mapId: 7,
  center: { id: CHANNEL_ID, title: 'Centre' },
} as unknown as MapSnapshot;

class FakeEngine implements Engine {
  stored: MapSnapshot | null = snapshot;
  lookups: string[] = [];
  crawls: Array<{ channel: string; depth: number }> = [];
  outcome: Promise<CrawlOutcome> = Promise.resolve({ centerChannelId: CHANNEL_ID, warnings: [] });

  findSnapshot(channel: string): MapSnapshot | null {
    this.lookups.push(channel);
    return this.stored;
  }

  crawl(channel: string, depth: number, onProgress: Parameters<Engine['crawl']>[2]) {
    this.crawls.push({ channel, depth });
    onProgress({ stage: 'reading-channels', channels: 3, step: 1 });
    return this.outcome;
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

  test.each([
    [{ channel: 'https://evil.example/@x' }, 'a host that is not YouTube'],
    [{ channel: '@veritasium', depth: 3 }, 'a depth that is not supported'],
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

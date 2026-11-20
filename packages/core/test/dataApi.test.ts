import { describe, expect, test } from 'vitest';
import { fetchChannelFacts } from '../src/sources/dataApi';

const KEY = 'test-key-not-a-real-one';
const cid = (letter: string) => `UC${letter.repeat(22)}`;

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** A stand-in for the network that answers with the given bodies in turn. */
function fakeFetch(replies: ReadonlyArray<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  let next = 0;
  const fetcher = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    const reply = replies[Math.min(next, replies.length - 1)] ?? { body: {} };
    next += 1;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  return { fetcher, calls };
}

const item = (letter: string, overrides: Record<string, unknown> = {}) => ({
  id: cid(letter),
  snippet: { publishedAt: '2026-09-01T10:00:00Z', country: 'US' },
  statistics: {
    viewCount: '123456',
    videoCount: '12',
    subscriberCount: '890',
    hiddenSubscriberCount: false,
  },
  ...overrides,
});

describe('fetchChannelFacts', () => {
  test('reads when a channel was created, where it is and how big it is', async () => {
    const { fetcher } = fakeFetch([{ body: { items: [item('A')] } }]);

    const facts = await fetchChannelFacts([cid('A')], { apiKey: KEY, fetch: fetcher });

    expect(facts).toEqual([
      {
        id: cid('A'),
        createdAt: new Date('2026-09-01T10:00:00Z'),
        country: 'US',
        totalViews: 123_456,
        videoCount: 12,
        subscribers: 890,
        subscribersHidden: false,
      },
    ]);
  });

  test('sends the key in a header, never in the address', async () => {
    const { fetcher, calls } = fakeFetch([{ body: { items: [] } }]);

    await fetchChannelFacts([cid('A')], { apiKey: KEY, fetch: fetcher });

    expect(calls[0]?.url).not.toContain(KEY);
    expect(calls[0]?.headers['x-goog-api-key']).toBe(KEY);
    expect(calls[0]?.url).toContain(`id=${cid('A')}`);
  });

  test('asks for at most fifty channels in one request', async () => {
    const ids = Array.from({ length: 120 }, (_, n) => `UC${String(n).padStart(22, 'x')}`);
    const { fetcher, calls } = fakeFetch([{ body: { items: [] } }]);

    await fetchChannelFacts(ids, { apiKey: KEY, fetch: fetcher });

    expect(calls).toHaveLength(3);
  });

  test('makes no request for an empty list', async () => {
    const { fetcher, calls } = fakeFetch([{ body: { items: [] } }]);

    expect(await fetchChannelFacts([], { apiKey: KEY, fetch: fetcher })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test('reports a hidden subscriber count and a missing country as unknown', async () => {
    const hidden = item('A', {
      snippet: { publishedAt: '2026-09-01T10:00:00Z' },
      statistics: { viewCount: '5', videoCount: '1', hiddenSubscriberCount: true },
    });
    const { fetcher } = fakeFetch([{ body: { items: [hidden] } }]);

    const [facts] = await fetchChannelFacts([cid('A')], { apiKey: KEY, fetch: fetcher });

    expect(facts).toMatchObject({ country: null, subscribers: null, subscribersHidden: true });
  });

  test('skips an entry it cannot read instead of failing the batch', async () => {
    const { fetcher } = fakeFetch([
      { body: { items: [{ id: cid('A'), snippet: { publishedAt: 'not a date' } }, item('B')] } },
    ]);

    const facts = await fetchChannelFacts([cid('A'), cid('B')], { apiKey: KEY, fetch: fetcher });

    expect(facts.map((entry) => entry.id)).toEqual([cid('B')]);
  });

  test('rejects ids that are not channel ids before making a request', async () => {
    const { fetcher, calls } = fakeFetch([{ body: { items: [] } }]);

    await expect(fetchChannelFacts(['../../etc'], { apiKey: KEY, fetch: fetcher })).rejects.toThrow(
      /channel id/,
    );
    expect(calls).toHaveLength(0);
  });

  test('says so when the daily allowance is used up', async () => {
    const { fetcher } = fakeFetch([
      {
        status: 403,
        body: {
          error: { code: 403, message: 'Quota exceeded', errors: [{ reason: 'quotaExceeded' }] },
        },
      },
    ]);

    await expect(fetchChannelFacts([cid('A')], { apiKey: KEY, fetch: fetcher })).rejects.toThrow(
      /daily allowance/,
    );
  });

  test('never repeats the key in an error', async () => {
    const { fetcher } = fakeFetch([
      { status: 400, body: { error: { code: 400, message: `API key not valid: ${KEY}` } } },
    ]);

    const failure = await fetchChannelFacts([cid('A')], { apiKey: KEY, fetch: fetcher }).catch(
      (error: unknown) => (error instanceof Error ? error.message : ''),
    );

    expect(failure).toMatch(/400/);
    expect(failure).not.toContain(KEY);
  });

  test('refuses to run without a key', async () => {
    const { fetcher } = fakeFetch([{ body: { items: [] } }]);

    await expect(fetchChannelFacts([cid('A')], { apiKey: ' ', fetch: fetcher })).rejects.toThrow(
      /YOUTUBE_API_KEY/,
    );
  });
});

import { describe, expect, test } from 'vitest';
import { apiCaller } from '../src/lib/api';
import { createQueryCache, DATA_VERSION_HEADER, isOlder } from '../src/lib/queryCache';

/** A stand-in server: answers each request with how many it has had, and the version set. */
function server() {
  let version = 'r:1.0-0';
  const asked: string[] = [];
  const fetcher = (path: string, init?: RequestInit): Promise<Response> => {
    asked.push(`${init?.method ?? 'GET'} ${path}`);
    if (init?.method === 'POST') version = 'r:1.1-1';
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, data: { calls: asked.length }, error: null }), {
        status: 200,
        headers: { [DATA_VERSION_HEADER]: version },
      }),
    );
  };
  return {
    fetcher,
    asked: () => asked.length,
    setVersion: (next: string) => (version = next),
  };
}

const calls = (reply: { readonly data: unknown }) => (reply.data as { calls: number }).calls;

describe('the page cache', () => {
  test('keeps a slow read: the second ask is answered without the server', async () => {
    const api = server();
    const { call } = apiCaller(api.fetcher, createQueryCache());

    const first = await call('/api/transfers?channel=UCa');
    const second = await call('/api/transfers?channel=UCa');

    expect(calls(second)).toBe(calls(first));
    expect(api.asked()).toBe(1);
  });

  test('asks once for identical reads asked at once, kept or not', async () => {
    const api = server();
    const { call } = apiCaller(api.fetcher, createQueryCache());

    await Promise.all([call('/api/jobs'), call('/api/jobs'), call('/api/jobs')]);

    expect(api.asked()).toBe(1);
  });

  test('asks every time for a read that says what is running', async () => {
    const api = server();
    const { call } = apiCaller(api.fetcher, createQueryCache());

    await call('/api/jobs');
    await call('/api/jobs');

    expect(api.asked()).toBe(2);
  });

  test('reads again after a write from the page', async () => {
    const api = server();
    const { call, send } = apiCaller(api.fetcher, createQueryCache());
    await call('/api/niches');

    await send('/api/niches/watch', { channel: 'UCa', watched: true });
    const after = await call('/api/niches');

    expect(calls(after)).toBe(3);
  });

  test('reads again once the server says the store changed (a refresh or job finished)', async () => {
    const api = server();
    const { call } = apiCaller(api.fetcher, createQueryCache());
    await call('/api/maps/latest?channel=UCa');

    api.setVersion('r:1.5-0');
    await call('/api/jobs');
    const after = await call('/api/maps/latest?channel=UCa');

    expect(calls(after)).toBe(3);
  });

  test('never keeps a failure', async () => {
    let asked = 0;
    const fetcher = () => {
      asked += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ success: false, data: null, error: 'no' }), { status: 500 }),
      );
    };
    const { call } = apiCaller(fetcher, createQueryCache());

    await call('/api/bank');
    await call('/api/bank');

    expect(asked).toBe(2);
  });

  test('asks every time when the caller brings its own way to fetch (tests)', async () => {
    const api = server();
    const { call } = apiCaller(api.fetcher);

    await call('/api/transfers');
    await call('/api/transfers');

    expect(api.asked()).toBe(2);
  });

  test('drops a kept read once it is ten minutes old', async () => {
    const api = server();
    let clock = 0;
    const { call } = apiCaller(
      api.fetcher,
      createQueryCache(() => clock),
    );
    await call('/api/flow?channel=UCa');

    clock = 10 * 60 * 1000 + 1;
    await call('/api/flow?channel=UCa');

    expect(api.asked()).toBe(2);
  });
});

describe('which of two data versions is older', () => {
  test('an answer read before a write is older than the write', () => {
    expect(isOlder('r:1.4-0', 'r:1.5-0')).toBe(true);
    expect(isOlder('r:1.5-0', 'r:1.4-0')).toBe(false);
    expect(isOlder('r:1.5-0', 'r:1.5-0')).toBe(false);
  });

  test('a version of a restarted server is new, never older', () => {
    expect(isOlder('s:1.0-0', 'r:1.5-0')).toBe(false);
  });

  test('a missing version is never older', () => {
    expect(isOlder(null, 'r:1.5-0')).toBe(false);
    expect(isOlder('r:1.5-0', null)).toBe(false);
  });
});

describe('a read the page sends as POST', () => {
  test('drops nothing kept', async () => {
    const api = server();
    const { call, send } = apiCaller(api.fetcher, createQueryCache());
    await call('/api/niches');

    await send('/api/breakdowns/candidates', { ids: [] });
    api.setVersion('r:1.0-0');
    await call('/api/niches');

    expect(api.asked()).toBe(2);
  });
});

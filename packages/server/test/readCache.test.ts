import { openDatabase } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { storeVersion, versioned } from '../src/readCache';
import { DATA_VERSION_HEADER, keptReads } from '../src/readAnswers';

describe('the store version', () => {
  test('changes when this connection writes, and holds when it only reads', () => {
    const db = openDatabase(':memory:');
    const version = storeVersion(db);
    const before = version();
    db.prepare('SELECT count(*) FROM channels').get();
    expect(version()).toBe(before);

    db.prepare(
      "INSERT INTO channels (id, title, subs_hidden, fetched_at) VALUES ('UCx', 'A', 0, '2026-01-01')",
    ).run();

    expect(version()).not.toBe(before);
    db.close();
  });
});

describe('a read kept until the store changes', () => {
  test('is worked out once while nothing changes', () => {
    const kept = versioned({ version: () => 'v1' });
    let worked = 0;
    const read = () => kept.get('map', () => ++worked);

    expect([read(), read(), read()]).toEqual([1, 1, 1]);
    expect(worked).toBe(1);
  });

  test('is worked out again after a write', () => {
    let version = 'v1';
    const kept = versioned({ version: () => version });
    let worked = 0;
    kept.get('map', () => ++worked);

    version = 'v2';

    expect(kept.get('map', () => ++worked)).toBe(2);
  });

  test('is worked out again once it is older than the longest it may be kept', () => {
    let clock = 0;
    const kept = versioned({ version: () => 'v1', now: () => clock, maxAgeMs: 1000 });
    let worked = 0;
    kept.get('map', () => ++worked);

    clock = 1001;

    expect(kept.get('map', () => ++worked)).toBe(2);
  });

  test('is not kept when the store changed while it was worked out', () => {
    let version = 1;
    const kept = versioned({ version: () => String(version) });
    let worked = 0;
    const writing = () => {
      version += 1;
      return ++worked;
    };
    kept.get('map', writing);
    kept.get('map', writing);

    expect(worked).toBe(2);
  });

  test('keeps no more than it is allowed, forgetting the oldest first', () => {
    const kept = versioned({ version: () => 'v1', maxEntries: 2 });
    let worked = 0;
    for (const key of ['a', 'b', 'c']) kept.get(key, () => ++worked);

    kept.get('c', () => ++worked);
    kept.get('a', () => ++worked);

    expect(worked).toBe(4);
  });
});

const GET = (path: string) => new Request(`http://127.0.0.1:4317${path}`);
const POST = (path: string) => new Request(`http://127.0.0.1:4317${path}`, { method: 'POST' });
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function counting(answer: (request: Request, calls: number) => Response) {
  let calls = 0;
  const handler = (request: Request) => {
    calls += 1;
    return Promise.resolve(answer(request, calls));
  };
  return { handler, calls: () => calls };
}

describe('the kept answers to the slow reads', () => {
  test('answer a repeated read from memory, with the version on every answer', async () => {
    const api = counting((_request, calls) => json({ calls }));
    const app = keptReads(api.handler, { storeVersion: () => 's1' });

    const first = await app(GET('/api/transfers?channel=UCa'));
    const second = await app(GET('/api/transfers?channel=UCa'));

    expect(await second.json()).toEqual(await first.json());
    expect(api.calls()).toBe(1);
    expect(second.headers.get(DATA_VERSION_HEADER)).toBe('s1-0');
  });

  test('read the store again after a write: the next read is fresh', async () => {
    let store = 's1';
    const api = counting((_request, calls) => json({ calls }));
    const app = keptReads(api.handler, { storeVersion: () => store });
    await app(GET('/api/maps/latest?channel=UCa'));

    store = 's2';
    const after = await app(GET('/api/maps/latest?channel=UCa'));

    expect(await after.json()).toEqual({ success: true, data: { calls: 2 } });
    expect(after.headers.get(DATA_VERSION_HEADER)).toBe('s2-0');
  });

  test('count a write through the API as a change, for what is not in the store', async () => {
    const api = counting((_request, calls) => json({ calls }));
    const app = keptReads(api.handler, { storeVersion: () => 's1' });
    await app(GET('/api/niches'));

    const saved = await app(POST('/api/settings'));
    const after = await app(GET('/api/niches'));

    expect(saved.headers.get(DATA_VERSION_HEADER)).toBe('s1-1');
    expect(await after.json()).toEqual({ success: true, data: { calls: 3 } });
  });

  test('work out identical reads asked at once only once', async () => {
    const api = counting((_request, calls) => json({ calls }));
    const app = keptReads(api.handler, { storeVersion: () => 's1' });

    const answers = await Promise.all([
      app(GET('/api/flow?channel=UCa')),
      app(GET('/api/flow?channel=UCa')),
    ]);

    expect(api.calls()).toBe(1);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
  });

  test('keep apart reads that ask for different things', async () => {
    const api = counting((_request, calls) => json({ calls }));
    const app = keptReads(api.handler, { storeVersion: () => 's1' });

    await app(GET('/api/transfers?channel=UCa'));
    await app(GET('/api/transfers?channel=UCb'));

    expect(api.calls()).toBe(2);
  });

  test('never keep a failed read', async () => {
    const api = counting((_request, calls) => json({ calls }, calls === 1 ? 500 : 200));
    const app = keptReads(api.handler, { storeVersion: () => 's1' });

    expect((await app(GET('/api/bank'))).status).toBe(500);
    expect((await app(GET('/api/bank'))).status).toBe(200);
  });

  test('never keep a read that threw, and let the error through', async () => {
    let calls = 0;
    const app = keptReads(
      () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('broken')) : Promise.resolve(json({}));
      },
      { storeVersion: () => 's1' },
    );

    await expect(app(GET('/api/bank'))).rejects.toThrow('broken');
    expect((await app(GET('/api/bank'))).status).toBe(200);
  });

  test('pass every other request through, each time', async () => {
    const api = counting((_request, calls) => json({ calls }));
    const app = keptReads(api.handler, { storeVersion: () => 's1' });

    await app(GET('/api/jobs'));
    await app(GET('/api/jobs'));

    expect(api.calls()).toBe(2);
  });
});

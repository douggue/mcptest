import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import type { ExtrasEngine } from '../src/extrasTypes';
import { JobStore } from '../src/jobs';
import type { RiskView } from '../src/riskTypes';
import { CHANNEL_ID, HOST, get, post, read, stubEngine, withExtras } from './support';

const appWith = (parts: Partial<ExtrasEngine>) =>
  createApp({ engine: stubEngine(withExtras(parts)), jobs: new JobStore(), allowedHosts: [HOST] });

const view: RiskView = { centerChannelId: CHANNEL_ID, concepts: [], check: null };

describe('GET /api/risk', () => {
  test('answers the scripted concepts and the chosen check', async () => {
    const asked: unknown[] = [];
    const app = appWith({
      findRisk: (channel, concept) => {
        asked.push([channel, concept]);
        return view;
      },
    });

    expect(
      (await read<RiskView>(await get(app, `/api/risk?channel=${CHANNEL_ID}&concept=4`))).data,
    ).toEqual(view);
    await get(app, `/api/risk?channel=${CHANNEL_ID}`);
    expect(asked).toEqual([
      [CHANNEL_ID, 4],
      [CHANNEL_ID, null],
    ]);
  });

  test('refuses a concept that is not a whole number, and answers 404 with no map', async () => {
    expect((await get(appWith({}), `/api/risk?channel=${CHANNEL_ID}&concept=x`)).status).toBe(400);
    expect(
      (await get(appWith({ findRisk: () => null }), `/api/risk?channel=${CHANNEL_ID}`)).status,
    ).toBe(404);
    expect((await get(appWith({}), '/api/risk?channel=nope')).status).toBe(400);
  });
});

describe('POST /api/risk/ask', () => {
  test('asks as a job and answers what was kept', async () => {
    const app = appWith({
      findRisk: () => view,
      askRisk: async () => ({ claims: 2, notes: 1, dropped: 0, engine: 'claude' }),
    });

    const started = await post(app, '/api/risk/ask', { channel: CHANNEL_ID, conceptId: 4 });
    expect(started.status).toBe(202);
    const { jobId } = (await read<{ jobId: string }>(started)).data as { jobId: string };
    let job: { status: string; result: unknown } | null = null;
    for (let tries = 0; tries < 50 && job?.status !== 'done'; tries += 1) {
      job = (
        await read<{ status: string; result: unknown }>(
          await get(app, `/api/extras/job?id=${jobId}`),
        )
      ).data;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(job).toMatchObject({
      status: 'done',
      result: { kind: 'risk-check', outcome: { claims: 2 } },
    });
  });

  test('passes the same checks as every other write', async () => {
    const app = appWith({ findRisk: () => view });
    const body = { channel: CHANNEL_ID, conceptId: 4 };

    expect((await post(app, '/api/risk/ask', { ...body, conceptId: 0 })).status).toBe(400);
    expect((await post(app, '/api/risk/ask', { ...body, engine: 'nobody' })).status).toBe(400);
    expect(
      (await post(app, '/api/risk/ask', body, { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await post(app, '/api/risk/ask', body, { 'content-type': 'text/plain' })).status).toBe(
      415,
    );
    expect((await post(appWith({ findRisk: () => null }), '/api/risk/ask', body)).status).toBe(404);
    expect((await get(app, '/api/risk/ask')).status).toBe(405);
  });
});

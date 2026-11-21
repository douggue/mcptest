import type { PlanView } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import type { ExtrasEngine } from '../src/extrasTypes';
import { JobStore } from '../src/jobs';
import { CHANNEL_ID, HOST, get, post, read, stubEngine, withExtras } from './support';

const appWith = (parts: Partial<ExtrasEngine>) =>
  createApp({ engine: stubEngine(withExtras(parts)), jobs: new JobStore(), allowedHosts: [HOST] });

const plan: PlanView = { centerChannelId: CHANNEL_ID, linked: [], table: [], linkable: [] };
const body = { channel: CHANNEL_ID, conceptId: 4, link: 'https://youtu.be/abcdefghijk' };

describe('GET /api/plan', () => {
  test("answers the channel's plan, 404 with no map, 400 for a bad channel", async () => {
    const response = await get(
      appWith({ findPlan: () => plan }),
      `/api/plan?channel=${CHANNEL_ID}`,
    );
    expect((await read<PlanView>(response)).data).toEqual(plan);
    expect(
      (await get(appWith({ findPlan: () => null }), `/api/plan?channel=${CHANNEL_ID}`)).status,
    ).toBe(404);
    expect((await get(appWith({}), '/api/plan?channel=x')).status).toBe(400);
  });
});

describe('POST /api/plan/link', () => {
  test('links and answers the plan', async () => {
    const asked: unknown[] = [];
    const app = appWith({
      linkPlanVideo: async (...args) => {
        asked.push(args);
        return { outcome: 'linked', plan };
      },
    });

    const response = await post(app, '/api/plan/link', body);

    expect(response.status).toBe(200);
    expect(asked).toEqual([[CHANNEL_ID, 4, body.link]]);
  });

  test.each([
    ['bad-link', 400, 'Paste a link to one YouTube video, or its id.'],
    ['other-channel', 400, 'That video is from another channel. Link a video of this channel.'],
    [
      'not-found',
      404,
      "That video was not found among this channel's videos, even after reading the channel again.",
    ],
    ['video-taken', 409, 'That video is already linked to another concept of this channel.'],
    ['no-concept', 404, 'There is no kept concept with that number for this channel.'],
    ['no-map', 404, 'No map has been made for this channel yet'],
  ] as const)('answers %s with %i and a plain reason', async (outcome, status, message) => {
    const app = appWith({ linkPlanVideo: async () => ({ outcome, plan: null }) });

    const response = await post(app, '/api/plan/link', body);

    expect(response.status).toBe(status);
    expect((await read(response)).error).toBe(message);
  });

  test('says plainly when YouTube could not be read', async () => {
    const app = appWith({
      linkPlanVideo: async () => {
        throw new Error('Another program is reading YouTube');
      },
    });

    const response = await post(app, '/api/plan/link', body);

    expect(response.status).toBe(502);
    expect((await read(response)).error).toBe(
      'The channel could not be read from YouTube: Another program is reading YouTube',
    );
  });

  test('passes the same checks as every other write', async () => {
    const app = appWith({ linkPlanVideo: async () => ({ outcome: 'linked', plan }) });

    expect((await post(app, '/api/plan/link', { ...body, conceptId: -1 })).status).toBe(400);
    expect((await post(app, '/api/plan/link', { ...body, link: 'x'.repeat(600) })).status).toBe(
      400,
    );
    expect(
      (await post(app, '/api/plan/link', body, { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await post(app, '/api/plan/link', body, { 'content-type': 'text/plain' })).status).toBe(
      415,
    );
    expect((await get(app, '/api/plan/link')).status).toBe(405);
  });
});

describe('POST /api/plan/unlink', () => {
  test('unlinks and answers the plan, 404 with no map', async () => {
    expect(
      (await post(appWith({ unlinkPlanVideo: () => plan }), '/api/plan/unlink', body)).status,
    ).toBe(200);
    expect(
      (await post(appWith({ unlinkPlanVideo: () => null }), '/api/plan/unlink', body)).status,
    ).toBe(404);
  });
});

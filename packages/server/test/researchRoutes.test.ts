import { describe, expect, test } from 'vitest';
import { createApp, type Engine } from '../src/app';
import { JobStore } from '../src/jobs';
import type { ClaimsOutcome, ResearchOutcome } from '../src/researchEngine';
import { CHANNEL_ID, HOST, get, post, read, stubEngine } from './support';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const appWith = (parts: Partial<Engine>) =>
  createApp({ engine: stubEngine(parts), jobs: new JobStore(), allowedHosts: [HOST] });
const found = { findConcept: (_c: string, id: number) => (id === 7 ? ({} as never) : null) };

describe('the research routes', () => {
  test('read a concept’s fact sheet and claims', async () => {
    const view = { sheet: null, claims: [] };
    const app = appWith({ findResearch: () => view });

    const reply = await get(app, `/api/lab/research?channel=${CHANNEL_ID}&concept=7`);
    expect((await read(reply)).data).toEqual(view);
    expect((await get(app, `/api/lab/research?channel=${CHANNEL_ID}&concept=x`)).status).toBe(400);
  });

  test('start a research run and a claims check for a concept of this channel only', async () => {
    const runs: unknown[] = [];
    const app = appWith({
      ...found,
      researchConcept: async (channel, concept, only) => {
        runs.push(['research', channel, concept, only]);
        return {} as ResearchOutcome;
      },
      checkClaims: async (channel, concept) => {
        runs.push(['claims', channel, concept]);
        return {} as ClaimsOutcome;
      },
    });

    const research = await post(app, '/api/lab/research', {
      channel: CHANNEL_ID,
      concept: 7,
      engine: 'claude',
    });
    await settle();
    const claims = await post(app, '/api/lab/claims', { channel: CHANNEL_ID, concept: 7 });
    await settle();
    const missing = await post(app, '/api/lab/claims', { channel: CHANNEL_ID, concept: 8 });

    expect([research.status, claims.status, missing.status]).toEqual([202, 202, 404]);
    expect(runs).toEqual([
      ['research', CHANNEL_ID, 7, 'claude'],
      ['claims', CHANNEL_ID, 7],
    ]);
  });
});

import { describe, expect, test } from 'vitest';
import { createApp, type Engine } from '../src/app';
import type { ConceptThumbnailOutcome, ConceptThumbnailView } from '../src/conceptThumbEngine';
import { JobStore } from '../src/jobs';
import { CHANNEL_ID, HOST, get, post, read, stubEngine } from './support';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const PATH = '/api/lab/concepts/thumbnail';

const view: ConceptThumbnailView = {
  conceptId: 7,
  prompt: 'A dark close-up.',
  why: 'Winners fill the frame.',
  learnedFrom: [],
  engine: 'claude',
  writtenAt: '2026-11-21T12:00:00.000Z',
};
const outcome: ConceptThumbnailOutcome = {
  kind: 'concept-thumbnail',
  thumbnail: view,
  engine: 'claude',
  skipped: [],
};

const appWith = (parts: Partial<Engine>) =>
  createApp({ engine: stubEngine(parts), jobs: new JobStore(), allowedHosts: [HOST] });

describe('a concept’s thumbnail prompt over HTTP', () => {
  test('starts a job for a concept of this channel, with the engine chosen', async () => {
    const asked: unknown[] = [];
    const app = appWith({
      findConcept: (channel, concept) => (concept === 7 ? ({ channel } as never) : null),
      writeConceptThumbnail: async (channel, concept, only) => {
        asked.push([channel, concept, only]);
        return outcome;
      },
    });

    const started = await post(app, PATH, { channel: CHANNEL_ID, concept: 7, engine: 'codex' });
    await settle();
    const missing = await post(app, PATH, { channel: CHANNEL_ID, concept: 8 });
    const bad = await post(app, PATH, { channel: CHANNEL_ID, concept: 'seven' });

    expect([started.status, missing.status, bad.status]).toEqual([202, 404, 400]);
    expect(asked).toEqual([[CHANNEL_ID, 7, 'codex']]);
  });

  test('lists the stored prompts of a channel’s concepts, and 404 with no map', async () => {
    const app = appWith({
      listConceptThumbnails: (channel) => (channel === CHANNEL_ID ? [view] : null),
    });

    const listed = await get(app, `/api/lab/concepts/thumbnails?channel=${CHANNEL_ID}`);
    const none = await get(app, `/api/lab/concepts/thumbnails?channel=UC${'x'.repeat(22)}`);

    expect((await read(listed)).data).toEqual({ thumbnails: [view] });
    expect(none.status).toBe(404);
  });
});

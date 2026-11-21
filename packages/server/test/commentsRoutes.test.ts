import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import type { CommentsView } from '../src/commentsTypes';
import type { ExtrasEngine } from '../src/extrasTypes';
import { JobStore } from '../src/jobs';
import { CHANNEL_ID, HOST, get, post, read, stubEngine, withExtras } from './support';

const appWith = (parts: Partial<ExtrasEngine>) =>
  createApp({ engine: stubEngine(withExtras(parts)), jobs: new JobStore(), allowedHosts: [HOST] });

const VIDEO = 'abcdefghijk';
const view = (keySet: boolean): CommentsView => ({
  centerChannelId: CHANNEL_ID,
  keySet,
  unitsPerVideo: 1,
  maxVideos: 10,
  dailyUnits: 10_000,
  candidates: [],
  answer: null,
});

interface JobReply {
  readonly status: string;
  readonly result: unknown;
  readonly error: string | null;
}

/** Polls an extras job until it is no longer running. */
async function finished(app: ReturnType<typeof appWith>, id: string): Promise<JobReply> {
  for (let tries = 0; tries < 50; tries += 1) {
    const job = (await read<JobReply>(await get(app, `/api/extras/job?id=${id}`))).data;
    if (job && job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('The job did not finish');
}

describe('GET /api/comments', () => {
  test('answers what is known, 404 with no map, 400 for a bad channel', async () => {
    const found = await get(
      appWith({ findComments: () => view(true) }),
      `/api/comments?channel=${CHANNEL_ID}`,
    );
    expect((await read<CommentsView>(found)).data).toEqual(view(true));
    expect(
      (await get(appWith({ findComments: () => null }), `/api/comments?channel=${CHANNEL_ID}`))
        .status,
    ).toBe(404);
    expect((await get(appWith({}), '/api/comments?channel=x')).status).toBe(400);
  });
});

describe('POST /api/comments/read', () => {
  test('reads the chosen videos as a job and answers how each went', async () => {
    const app = appWith({
      findComments: () => view(true),
      readComments: async (_channel, ids, onProgress) => {
        onProgress(1, 1);
        return ids.map((videoId) => ({
          videoId,
          status: 'read' as const,
          count: 4,
          problem: null,
        }));
      },
    });

    const started = await post(app, '/api/comments/read', {
      channel: CHANNEL_ID,
      videoIds: [VIDEO],
    });
    expect(started.status).toBe(202);
    const { jobId } = (await read<{ jobId: string }>(started)).data as { jobId: string };

    expect(await finished(app, jobId)).toMatchObject({
      status: 'done',
      result: { kind: 'comments-read', outcomes: [{ videoId: VIDEO, status: 'read', count: 4 }] },
    });
  });

  test('says so plainly when no key is set, before starting anything', async () => {
    const app = appWith({ findComments: () => view(false) });

    const response = await post(app, '/api/comments/read', {
      channel: CHANNEL_ID,
      videoIds: [VIDEO],
    });

    expect(response.status).toBe(400);
    expect((await read(response)).error).toMatch(/No YouTube API key is set/);
  });

  test('passes the same checks as every other write', async () => {
    const app = appWith({ findComments: () => view(true) });
    const body = { channel: CHANNEL_ID, videoIds: [VIDEO] };

    expect((await post(app, '/api/comments/read', { ...body, videoIds: [] })).status).toBe(400);
    expect(
      (await post(app, '/api/comments/read', { ...body, videoIds: Array(11).fill(VIDEO) })).status,
    ).toBe(400);
    expect((await post(app, '/api/comments/read', { ...body, videoIds: ['bad'] })).status).toBe(
      400,
    );
    expect(
      (await post(app, '/api/comments/read', body, { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect(
      (await post(app, '/api/comments/read', body, { 'content-type': 'text/plain' })).status,
    ).toBe(415);
    expect((await get(app, '/api/comments/read')).status).toBe(405);
    expect(
      (await post(appWith({ findComments: () => null }), '/api/comments/read', body)).status,
    ).toBe(404);
  });
});

describe('POST /api/comments/ask', () => {
  test('asks as a job in the one AI slot and answers the outcome', async () => {
    const app = appWith({
      findComments: () => view(true),
      askViewers: async () => ({ proposed: 3, dropped: 1, unread: 0, engine: 'claude' }),
    });

    const started = await post(app, '/api/comments/ask', {
      channel: CHANNEL_ID,
      videoIds: [VIDEO],
      engine: 'claude',
    });
    const { jobId } = (await read<{ jobId: string }>(started)).data as { jobId: string };

    expect(await finished(app, jobId)).toMatchObject({
      status: 'done',
      result: { kind: 'viewer-answer', outcome: { proposed: 3, dropped: 1 } },
    });
    expect(
      (
        await post(app, '/api/comments/ask', {
          channel: CHANNEL_ID,
          videoIds: [VIDEO],
          engine: 'nobody',
        })
      ).status,
    ).toBe(400);
  });

  test('says a failed run in plain words on the job', async () => {
    const app = appWith({
      findComments: () => view(true),
      askViewers: async () => {
        throw new Error('Some of these videos have no stored comments. Read their comments first.');
      },
    });

    const started = await post(app, '/api/comments/ask', {
      channel: CHANNEL_ID,
      videoIds: [VIDEO],
    });
    const { jobId } = (await read<{ jobId: string }>(started)).data as { jobId: string };

    expect(await finished(app, jobId)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/Read their comments first/),
    });
  });
});

describe('GET /api/extras/job', () => {
  test('answers 404 for a job it does not know, and 400 without an id', async () => {
    expect((await get(appWith({}), '/api/extras/job?id=nope')).status).toBe(404);
    expect((await get(appWith({}), '/api/extras/job')).status).toBe(400);
  });
});

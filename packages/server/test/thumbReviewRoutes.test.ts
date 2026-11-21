import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import type { ExtrasEngine } from '../src/extrasTypes';
import { JobStore } from '../src/jobs';
import type { PickableVideos, ThumbReviewView } from '../src/thumbReviewTypes';
import { CHANNEL_ID, HOST, get, post, read, stubEngine, withExtras } from './support';

const appWith = (parts: Partial<ExtrasEngine>) =>
  createApp({ engine: stubEngine(withExtras(parts)), jobs: new JobStore(), allowedHosts: [HOST] });

const VIDEO = 'aaaaaaaaaaa';
const videos: PickableVideos = { own: [], map: [], reviewed: [] };
const review = { comparedAt: '2026-11-21T10:00:00.000Z' } as ThumbReviewView;

interface JobReply {
  readonly status: string;
  readonly result: unknown;
  readonly error: string | null;
}

async function finished(app: ReturnType<typeof appWith>, jobId: string): Promise<JobReply | null> {
  for (let tries = 0; tries < 50; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const job = (await read<JobReply>(await get(app, `/api/extras/job?id=${jobId}`))).data;
    if (job && job.status !== 'running') return job;
  }
  return null;
}

describe('GET /api/thumbnail-review/videos', () => {
  test('answers the videos to pick from, and 404 with no map', async () => {
    const app = appWith({ thumbnailVideos: (channel) => (channel === CHANNEL_ID ? videos : null) });

    expect(
      (await read(await get(app, `/api/thumbnail-review/videos?channel=${CHANNEL_ID}`))).data,
    ).toEqual(videos);
    expect(
      (await get(app, `/api/thumbnail-review/videos?channel=UC${'n'.repeat(22)}`)).status,
    ).toBe(404);
    expect((await get(app, '/api/thumbnail-review/videos?channel=nope')).status).toBe(400);
  });
});

describe('GET /api/thumbnail-review', () => {
  test('answers a video’s kept review, or null when none is kept', async () => {
    const asked: unknown[] = [];
    const app = appWith({
      findThumbnailReview: (channel, video) => {
        asked.push([channel, video]);
        return video === VIDEO ? review : null;
      },
    });

    expect(
      (await read(await get(app, `/api/thumbnail-review?channel=${CHANNEL_ID}&video=${VIDEO}`)))
        .data,
    ).toEqual(review);
    expect(
      (await read(await get(app, `/api/thumbnail-review?channel=${CHANNEL_ID}&video=bbbbbbbbbbb`)))
        .data,
    ).toBeNull();
    expect(asked[0]).toEqual([CHANNEL_ID, VIDEO]);
  });

  test('refuses a video that is not an id, and a channel that is not one', async () => {
    expect(
      (await get(appWith({}), `/api/thumbnail-review?channel=${CHANNEL_ID}&video=x`)).status,
    ).toBe(400);
    expect((await get(appWith({}), `/api/thumbnail-review?channel=${CHANNEL_ID}`)).status).toBe(
      400,
    );
    expect((await get(appWith({}), `/api/thumbnail-review?channel=x&video=${VIDEO}`)).status).toBe(
      400,
    );
  });
});

describe('POST /api/thumbnail-review/ask', () => {
  test('asks as a job, passing the chosen engine and reporting its steps', async () => {
    // Arrange
    const asked: unknown[] = [];
    const app = appWith({
      thumbnailVideos: () => videos,
      askThumbnailReview: async (channel, video, only, report) => {
        asked.push([channel, video, only]);
        report?.('Counting');
        return { winners: 8, tagged: 17, rejected: 0, engine: 'claude' };
      },
    });

    // Act
    const started = await post(app, '/api/thumbnail-review/ask', {
      channel: CHANNEL_ID,
      videoId: VIDEO,
      engine: 'codex',
    });

    // Assert
    expect(started.status).toBe(202);
    const { jobId } = (await read<{ jobId: string }>(started)).data as { jobId: string };
    expect(await finished(app, jobId)).toMatchObject({
      status: 'done',
      result: { kind: 'thumbnail-review', outcome: { winners: 8 } },
    });
    expect(asked).toEqual([[CHANNEL_ID, VIDEO, 'codex']]);
  });

  test('ends the job with a plain message, without file paths, when the review fails', async () => {
    const app = appWith({
      thumbnailVideos: () => videos,
      askThumbnailReview: async () => {
        throw new Error('Could not read /home/owner/store.db');
      },
    });
    const started = await post(app, '/api/thumbnail-review/ask', {
      channel: CHANNEL_ID,
      videoId: VIDEO,
    });
    const { jobId } = (await read<{ jobId: string }>(started)).data as { jobId: string };
    const job = await finished(app, jobId);
    expect(job?.status).toBe('failed');
    expect(job?.error).not.toContain('/home/owner');
  });

  test('passes the same checks as every other write', async () => {
    const app = appWith({ thumbnailVideos: () => videos });
    const body = { channel: CHANNEL_ID, videoId: VIDEO };

    expect((await post(app, '/api/thumbnail-review/ask', { ...body, videoId: 'x' })).status).toBe(
      400,
    );
    expect(
      (await post(app, '/api/thumbnail-review/ask', { ...body, engine: 'nobody' })).status,
    ).toBe(400);
    expect(
      (await post(app, '/api/thumbnail-review/ask', body, { origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect(
      (await post(appWith({ thumbnailVideos: () => null }), '/api/thumbnail-review/ask', body))
        .status,
    ).toBe(404);
    expect((await get(app, '/api/thumbnail-review/ask')).status).toBe(405);
  });
});

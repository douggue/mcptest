import type { ApiVideoDetails, ThumbnailDownload, VideoPage, YouTubeSource } from '@jgtube/core';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { createEngine, type RunningEngine } from '../src/engine';
import { JobStore } from '../src/jobs';
import { HOST, get, post, read, stubEngine } from './support';

const PATH = '/api/thumbnails/download';
const DAY_MS = 86_400_000;
const START = new Date('2026-11-18T12:00:00Z');
const CHANNEL = `UC${'N'.repeat(22)}`;
const KEY = 'a-key-of-plausible-length';
const vid = (n: number) => `NNNNNNNNN${String(n).padStart(2, '0')}`;

const saved: ThumbnailDownload = {
  channelId: CHANNEL,
  channelTitle: 'Niche channel',
  folder: '/home/owner/jgtube/downloads/thumbnails/UCN',
  indexFile: '/home/owner/jgtube/downloads/thumbnails/UCN/index.json',
  saved: 7,
  alreadyThere: 2,
  failed: [{ videoId: vid(9), reason: 'it took too long to load' }],
  images: Array.from({ length: 9 }, (_, n) => ({
    videoId: vid(n),
    title: `Video ${n}`,
    views: 1000,
    score: 3,
    group: 'winner' as const,
    file: `${vid(n)}.jpg`,
  })),
};

describe('POST /api/thumbnails/download', () => {
  const appWith = (answer: () => Promise<ThumbnailDownload | null>, asked: string[] = []) =>
    createApp({
      engine: stubEngine({
        saveThumbnails: (channel) => {
          asked.push(channel);
          return answer();
        },
      }),
      jobs: new JobStore(),
      allowedHosts: [HOST],
    });

  test('saves the channel’s thumbnails and says where they are', async () => {
    const asked: string[] = [];

    const response = await post(
      appWith(async () => saved, asked),
      PATH,
      { channel: CHANNEL },
    );

    expect(response.status).toBe(200);
    expect(await read(response)).toEqual({
      success: true,
      data: {
        channel: CHANNEL,
        folder: saved.folder,
        indexFile: saved.indexFile,
        total: 9,
        saved: 7,
        alreadyThere: 2,
        failed: 1,
      },
      error: null,
      meta: null,
    });
    expect(asked).toEqual([CHANNEL]);
  });

  test.each([{}, { channel: '@handle' }, { channel: '../../etc' }, { channel: 42 }])(
    'refuses %j without asking the engine',
    async (body) => {
      const asked: string[] = [];

      const response = await post(
        appWith(async () => saved, asked),
        PATH,
        body,
      );

      expect(response.status).toBe(400);
      expect(asked).toEqual([]);
    },
  );

  test('answers 404 for a channel that has not been read', async () => {
    const response = await post(
      appWith(async () => null),
      PATH,
      { channel: CHANNEL },
    );

    expect(response.status).toBe(404);
    expect((await read(response)).error).toBe('That channel has not been read yet');
  });

  test('says why the files could not be saved, without the path that failed', async () => {
    const response = await post(
      appWith(async () => {
        throw new Error("EACCES: permission denied, mkdir '/home/owner/jgtube/downloads'");
      }),
      PATH,
      { channel: CHANNEL },
    );

    expect(response.status).toBe(500);
    const { error } = await read(response);
    expect(error).toMatch(/^The thumbnails could not be saved: EACCES: permission denied/);
    expect(error).not.toContain('/home/owner');
  });

  test('is a write: refused from another site, and only by POST', async () => {
    const app = appWith(async () => saved);

    const crossSite = await post(
      app,
      PATH,
      { channel: CHANNEL },
      { origin: 'https://evil.example' },
    );
    const wrongMethod = await get(app, PATH);

    expect(crossSite.status).toBe(403);
    expect(wrongMethod.status).toBe(405);
  });
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const level = {
  templateUrl: 'https://i.ytimg.com/sb/NNNNNNNNN00/storyboard3_L2/M$M.jpg?sqp=x&sigh=y',
  frameWidth: 160,
  frameHeight: 90,
  frameCount: 60,
  columns: 5,
  rows: 5,
  intervalMs: 10_000,
  sheetCount: 3,
};

interface World {
  readonly engine: RunningEngine;
  readonly folder: string;
  readonly pageCalls: string[];
  readonly imageCalls: string[];
  readonly apiCalls: string[][];
  channelCalls: number;
}

/** The real engine over a store file in a temporary folder, with YouTube and the pictures faked. */
function world(apiKey?: string): World {
  const folder = mkdtempSync(join(tmpdir(), 'jgtube-server-downloads-'));
  const made: World = {
    folder,
    pageCalls: [],
    imageCalls: [],
    apiCalls: [],
    channelCalls: 0,
    engine: undefined as unknown as RunningEngine,
  };
  const source: YouTubeSource = {
    resolveChannelId: async () => CHANNEL,
    getSidebar: async () => [],
    fetchChannel: async (channelId) => {
      made.channelCalls += 1;
      return {
        channel: {
          id: channelId,
          title: 'Niche channel',
          handle: 'niche',
          subscribers: 900,
          subscribersHidden: false,
          videoCount: 5,
        },
        videos: [40_000, 1000, 1200, 900, 1100].map((views, index) => ({
          id: vid(index),
          channelId,
          title: `How it was built ${index}`,
          views,
          durationSeconds: 900,
          published: {
            date: new Date(START.getTime() - (5 + index * 7) * DAY_MS),
            precision: 'day' as const,
            raw: `${5 + index * 7}d ago`,
          },
        })),
        brand: {
          description: 'We build things.',
          avatar: [{ url: 'https://yt3.googleusercontent.com/logo=s88', width: 88, height: 88 }],
          banner: [],
          keywords: ['building'],
          links: [],
        },
      };
    },
    fetchVideoPage: async (videoId, options = {}): Promise<VideoPage> => {
      made.pageCalls.push(videoId);
      return {
        videoId,
        details: {
          title: 'From the page',
          description: 'Page text',
          tags: [],
          durationSeconds: 900,
        },
        storyboard: [level],
        ...(options.transcript
          ? {
              transcript: {
                language: 'en',
                autoGenerated: true,
                segments: [{ startMs: 0, text: 'Hi' }],
              },
            }
          : {}),
      };
    },
  };
  (made as { engine: RunningEngine }).engine = createEngine(
    {
      dbPath: join(folder, 'store.db'),
      region: 'US',
      ...(apiKey ? { youtubeApiKey: apiKey } : {}),
    },
    {
      createSource: async () => source,
      now: () => START,
      fetchImage: async (url) => {
        made.imageCalls.push(url);
        return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
      },
      fetchVideoDetails: async (ids): Promise<readonly ApiVideoDetails[]> => {
        made.apiCalls.push([...ids]);
        return ids.map((videoId) => ({
          videoId,
          title: 'From the API',
          description: 'API text',
          tags: ['api'],
        }));
      },
    },
  );
  return made;
}

describe('the downloaders through the real engine', () => {
  let made: World;

  beforeEach(() => {
    made = world();
  });

  afterEach(() => {
    made.engine.close();
    rmSync(made.folder, { recursive: true, force: true });
  });

  test('reads a channel’s branding once, and the niche list then carries its logo', async () => {
    const first = await made.engine.readChannelBrand('@niche');
    const second = await made.engine.readChannelBrand(CHANNEL);

    expect(first.brand).toMatchObject({ description: 'We build things.', keywords: ['building'] });
    expect(second.fromStore).toBe(true);
    expect(made.channelCalls).toBe(1);
    expect(made.engine.listNiches().channels[0]).toMatchObject({
      id: CHANNEL,
      logoUrl: 'https://yt3.googleusercontent.com/logo=s88',
    });
  });

  test('saves a stored channel’s thumbnails into a downloads folder beside the store', async () => {
    await made.engine.readChannelBrand(CHANNEL);

    const result = await made.engine.saveThumbnails(CHANNEL);

    expect(result?.folder).toBe(join(made.folder, 'downloads', 'thumbnails', CHANNEL));
    expect(result).toMatchObject({ saved: 5, alreadyThere: 0, failed: [] });
    expect(readdirSync(result?.folder ?? '').sort()).toEqual([
      ...[0, 1, 2, 3, 4].map((n) => `${vid(n)}.jpg`),
      'index.json',
    ]);
    expect(made.imageCalls.every((url) => url.startsWith('https://i.ytimg.com/vi/'))).toBe(true);
  });

  test('has no thumbnails to save for a channel that is not stored', async () => {
    expect(await made.engine.saveThumbnails(CHANNEL)).toBeNull();
    expect(readdirSync(made.folder)).not.toContain('downloads');
  });

  test('reads a transcript once and answers from the store after', async () => {
    const first = await made.engine.readTranscript(vid(0));
    const second = await made.engine.readTranscript(vid(0));

    expect(first).toMatchObject({ fromStore: false, transcript: { language: 'en' } });
    expect(second.fromStore).toBe(true);
    expect(made.pageCalls).toEqual([vid(0)]);
  });

  test('loads the frame sheets of a video whose storyboard came with its transcript', async () => {
    await made.engine.readTranscript(vid(0));

    const frames = await made.engine.readVideoFrames(vid(0), 2);

    expect(frames?.sheets.map((entry) => entry.sheet.index)).toEqual([0, 2]);
    expect(frames?.sheets.every((entry) => entry.image.ok)).toBe(true);
    expect(made.pageCalls).toEqual([vid(0)]);
    expect(made.imageCalls.map((url) => new URL(url).pathname)).toEqual([
      '/sb/NNNNNNNNN00/storyboard3_L2/M0.jpg',
      '/sb/NNNNNNNNN00/storyboard3_L2/M2.jpg',
    ]);
  });

  test('sets a video’s description beside its stored views and score, one page per video', async () => {
    await made.engine.readChannelBrand(CHANNEL);

    const answer = await made.engine.readVideoDetails([vid(0), vid(1)]);

    expect(answer.videos[0]).toMatchObject({
      videoId: vid(0),
      title: 'How it was built 0',
      description: 'Page text',
      views: 40_000,
      channelId: CHANNEL,
    });
    expect(answer.videos[0]?.score).toBeGreaterThan(10);
    expect(answer).toMatchObject({ problems: [], apiProblem: null });
    expect(made.pageCalls).toEqual([vid(0), vid(1)]);
    expect(made.apiCalls).toEqual([]);
  });
});

describe('video details with the owner’s API key', () => {
  test('come from the official API in one request, with no page read', async () => {
    const made = world(KEY);
    try {
      const answer = await made.engine.readVideoDetails([vid(0), vid(1)]);

      expect(made.apiCalls).toEqual([[vid(0), vid(1)]]);
      expect(made.pageCalls).toEqual([]);
      expect(answer.videos.map((video) => video.description)).toEqual(['API text', 'API text']);
    } finally {
      made.engine.close();
      rmSync(made.folder, { recursive: true, force: true });
    }
  });
});

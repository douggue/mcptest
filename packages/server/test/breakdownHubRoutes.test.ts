import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp, type AppOptions, type Engine } from '../src/app';
import type { CandidateFacts } from '../src/breakdownCandidates';
import { shownName } from '../src/breakdownHubRoutes';
import { JobStore } from '../src/jobs';
import type { BreakdownHub, VideoBreakdownView, VideoTarget } from '../src/oneVideoTypes';
import { tinyMp4 } from './engines/standIn';
import { CHANNEL_ID, HOST, UNUSED_HUB, get, post, read, stubEngine } from './support';

const VIDEO = 'dQw4w9WgXcQ';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const candidate: CandidateFacts = {
  id: CHANNEL_ID,
  title: 'Maps',
  handle: '@maps',
  logoUrl: null,
  subscribers: 1000,
  storedVideos: 30,
  breakingOut: 2,
  recentBest: 6,
  top: [],
  brokenDownAt: null,
};

const view: VideoBreakdownView = {
  videoId: VIDEO,
  source: 'youtube',
  title: 'How maps lie',
  channelId: null,
  writtenAt: '2026-11-21T12:00:00.000Z',
  seen: {
    file: 'none',
    fileNote: null,
    watchedBy: null,
    framesBy: 'claude',
    frameSource: 'preview',
    frames: 40,
    captions: 'read',
    notes: [],
  },
  engine: 'claude',
  body: 'WHAT IT IS',
  prompts: { script: null, visual: null, thumbnail: null },
  problem: null,
};

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-hub-'));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const appWith = (
  hub: Partial<BreakdownHub>,
  parts: Partial<Engine> = {},
  maxUploadBytes?: number,
) =>
  createApp({
    engine: stubEngine({
      ownVideosFolder: () => join(folder, 'my-videos'),
      hub: { ...UNUSED_HUB, ...hub },
      ...parts,
    }),
    jobs: new JobStore(),
    allowedHosts: [HOST],
    ...(maxUploadBytes === undefined ? {} : { maxUploadBytes }),
  });

const put = (app: ReturnType<typeof createApp>, type: string, body: Uint8Array<ArrayBuffer>) =>
  app(
    new Request(`http://${HOST}/api/video-breakdowns/files`, {
      method: 'PUT',
      headers: { host: HOST, 'content-type': type },
      body,
    }),
  );

describe('the channels the Breakdown view offers', () => {
  test('are described from the store, for the ids asked', async () => {
    let asked: readonly string[] = [];
    const app = appWith({
      candidates: (ids) => {
        asked = ids;
        return [candidate];
      },
    });

    const reply = await read<{ candidates: CandidateFacts[] }>(
      await post(app, '/api/breakdowns/candidates', { ids: [CHANNEL_ID] }),
    );

    expect(reply.data.candidates).toEqual([candidate]);
    expect(asked).toEqual([CHANNEL_ID]);
  });

  test('refuse anything but channel ids, and other methods', async () => {
    const app = appWith({});

    expect((await post(app, '/api/breakdowns/candidates', { ids: ['@maps'] })).status).toBe(400);
    expect((await get(app, '/api/breakdowns/candidates')).status).toBe(405);
  });
});

describe('POST /api/breakdowns/channel', () => {
  test('reads a pasted channel and describes it', async () => {
    let read_: string | null = null;
    const app = appWith({
      readCandidate: async (channel) => {
        read_ = channel;
        return candidate;
      },
    });

    const reply = await read<{ candidate: CandidateFacts }>(
      await post(app, '/api/breakdowns/channel', { channel: ' https://www.youtube.com/@maps ' }),
    );

    expect(reply.data.candidate.id).toBe(CHANNEL_ID);
    expect(read_).toBe('https://www.youtube.com/@maps');
  });

  test('says plainly what is wrong: not a channel, YouTube busy elsewhere, or a read that failed', async () => {
    const failing = appWith({
      readCandidate: async () => {
        throw new Error('This channel does not exist');
      },
    });
    const bad = await post(failing, '/api/breakdowns/channel', { channel: 'not a channel at all' });
    expect(bad.status).toBe(400);
    expect((await read(bad)).error).toMatch(/@handle/);

    const lost = await post(failing, '/api/breakdowns/channel', { channel: '@nobody' });
    expect(lost.status).toBe(502);
    expect((await read(lost)).error).toMatch(/does not exist/);

    const elsewhere = appWith({}, { isReadingYouTube: () => true });
    expect((await post(elsewhere, '/api/breakdowns/channel', { channel: '@maps' })).status).toBe(
      409,
    );
  });

  test('waits for a map or refresh that holds the YouTube slot', async () => {
    const jobs: AppOptions['jobs'] = new JobStore();
    jobs.start(() => new Promise(() => undefined));
    const app = createApp({
      engine: stubEngine({ hub: { ...UNUSED_HUB, readCandidate: async () => candidate } }),
      jobs,
      allowedHosts: [HOST],
    });

    expect((await post(app, '/api/breakdowns/channel', { channel: '@maps' })).status).toBe(409);
  });
});

describe('POST /api/video-breakdowns', () => {
  test('starts a breakdown of a YouTube link as a job, listed in the work under way', async () => {
    let target: VideoTarget | null = null;
    let finish: (value: VideoBreakdownView) => void = () => undefined;
    const app = appWith({
      breakDownVideo: (asked, report) => {
        target = asked;
        report({ step: 'watching', text: 'Antigravity is watching it' });
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });

    const started = await post(app, '/api/video-breakdowns', {
      video: `https://youtu.be/${VIDEO}`,
      fresh: true,
    });
    expect(started.status).toBe(202);
    const { jobId } = (await read<{ jobId: string }>(started)).data;
    expect(target).toEqual({ kind: 'youtube', videoId: VIDEO });

    expect((await post(app, '/api/video-breakdowns', { video: VIDEO })).status).toBe(409);
    const listed = await read<{ jobs: Array<{ kind: string; videoId: string; progress: string }> }>(
      await get(app, '/api/jobs'),
    );
    expect(listed.data.jobs[0]).toMatchObject({
      kind: 'video-breakdown',
      videoId: VIDEO,
      progress: 'Antigravity is watching it',
    });

    finish(view);
    await settle();
    const job = await read<{ status: string; result: VideoBreakdownView }>(
      await get(app, `/api/jobs/${jobId}`),
    );
    expect(job.data.status).toBe('done');
    expect(job.data.result.title).toBe('How maps lie');
  });

  test('starts from a file the owner gave, by its id and with its name cleaned', async () => {
    let target: VideoTarget | null = null;
    const app = appWith({
      hasUpload: async () => true,
      breakDownVideo: async (asked) => {
        target = asked;
        return view;
      },
    });

    const started = await post(app, '/api/video-breakdowns', {
      file: 'Ab-_cdEFgh1',
      name: 'my\nclip.webm',
    });

    expect(started.status).toBe(202);
    expect(target).toEqual({ kind: 'file', videoId: 'Ab-_cdEFgh1', name: 'my clip.webm' });
  });

  test('refuses a bad link, both a link and a file, a file that is gone, or a run while another AI runs', async () => {
    const app = appWith({ hasUpload: async () => false });

    expect((await post(app, '/api/video-breakdowns', { video: 'not a video' })).status).toBe(400);
    expect((await post(app, '/api/video-breakdowns', { video: VIDEO, file: VIDEO })).status).toBe(
      400,
    );
    expect((await post(app, '/api/video-breakdowns', { file: VIDEO })).status).toBe(404);
    expect(
      (
        await app(
          new Request(`http://${HOST}/api/video-breakdowns`, {
            method: 'DELETE',
            headers: { host: HOST },
          }),
        )
      ).status,
    ).toBe(405);
  });

  test('takes the one slot every AI run shares', async () => {
    const app = appWith(
      { breakDownVideo: () => new Promise(() => undefined) },
      { breakDown: () => new Promise(() => undefined) },
    );
    expect((await post(app, '/api/breakdowns', { channel: CHANNEL_ID })).status).toBe(202);

    const refused = await post(app, '/api/video-breakdowns', { video: VIDEO });

    expect(refused.status).toBe(409);
    expect((await read(refused)).error).toMatch(/AI run/);
  });
});

describe('GET /api/video-breakdowns', () => {
  test('lists the kept breakdowns, and gives one by its video', async () => {
    const app = appWith({
      videoBreakdowns: () => [
        {
          videoId: VIDEO,
          source: 'youtube',
          title: 'How maps lie',
          writtenAt: view.writtenAt,
          written: true,
        },
      ],
      findVideoBreakdown: (id) => (id === VIDEO ? view : null),
    });

    const list = await read<{ items: unknown[] }>(await get(app, '/api/video-breakdowns'));
    expect(list.data.items).toHaveLength(1);
    expect((await read(await get(app, `/api/video-breakdowns?video=${VIDEO}`))).data).toEqual(view);
    expect((await read(await get(app, '/api/video-breakdowns?video=Zz9Zz9Zz9Zz'))).data).toBeNull();
    expect((await get(app, '/api/video-breakdowns?video=../x')).status).toBe(400);
  });
});

describe('PUT /api/video-breakdowns/files', () => {
  const saved = (): string[] =>
    existsSync(join(folder, 'my-videos')) ? readdirSync(join(folder, 'my-videos')) : [];

  test('saves a whole MP4 or a WebM under a new id, with its kind', async () => {
    const app = appWith({});

    const mp4 = await read<{ file: string; kind: string; bytes: number }>(
      await put(app, 'video/mp4', new Uint8Array(tinyMp4())),
    );
    const webm = await read<{ file: string; kind: string }>(
      await put(app, 'video/webm', new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])),
    );

    expect(mp4.data.kind).toBe('mp4');
    expect(webm.data.kind).toBe('webm');
    expect(saved().sort()).toEqual([`${mp4.data.file}.mp4`, `${webm.data.file}.webm`].sort());
  });

  test('refuses another kind, a file that is not what it says, an empty one or one too large, leaving nothing', async () => {
    const app = appWith({}, {}, 64);

    expect((await put(app, 'video/x-msvideo', new Uint8Array(tinyMp4()))).status).toBe(415);
    expect((await put(app, 'video/quicktime', new Uint8Array([1, 2, 3, 4]))).status).toBe(400);
    expect((await put(app, 'video/webm', new Uint8Array([1, 2, 3, 4]))).status).toBe(400);
    expect((await put(app, 'video/webm', new Uint8Array(0))).status).toBe(400);
    expect((await put(app, 'video/webm', new Uint8Array(200))).status).toBe(413);
    expect(saved()).toEqual([]);
  });
});

describe('a file name as shown', () => {
  test('has no control or path characters, and is never empty', () => {
    expect(shownName('a/b\\c\u0007.mov')).toBe('a b c .mov');
    expect(shownName('   ')).toBe('Your video file');
    expect(shownName(undefined)).toBe('Your video file');
    expect(shownName('x'.repeat(300))).toHaveLength(120);
  });
});

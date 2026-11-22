import type { TranscriptDownload } from '@jgtube/core';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp, type Engine } from '../src/app';
import type {
  BreakdownChoices,
  BreakdownOutcome,
  BreakdownProgress,
  BreakdownView,
} from '../src/breakdownTypes';
import { JobStore } from '../src/jobs';
import { tinyMp4 } from './engines/standIn';
import { CHANNEL_ID, HOST, get, post, read, stubEngine } from './support';

const VIDEO = 'dQw4w9WgXcQ';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const view: BreakdownView = {
  channel: { id: CHANNEL_ID, title: 'Channel' },
  writtenAt: '2026-11-21T09:30:00.000Z',
  parts: [
    {
      id: 'titles',
      title: 'Titles',
      state: 'written',
      body: 'THE TITLES STUDIED',
      prompt: null,
      engine: 'claude',
      writtenAt: '2026-11-21T09:30:00.000Z',
      reason: null,
      standInFor: null,
      unseen: false,
    },
  ],
  files: [{ id: 'whole', name: 'breakdown.txt', available: true, reason: null }],
  folder: '/downloads/breakdowns/Channel',
};

const outcome: BreakdownOutcome = {
  channel: { id: CHANNEL_ID, title: 'Channel' },
  storedVideos: 40,
  top: [{ videoId: VIDEO, title: 'A video', captions: 'read', words: 900, wordsPerMinute: 150 }],
  deep: [],
  supply: [],
  ownVideosFolder: '/downloads/my-videos',
  titles: 40,
  parts: [{ part: 'titles', outcome: 'written', engine: 'claude', skipped: [], seconds: 61 }],
  breakdown: view,
  notSaved: null,
};

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-upload-'));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const appWith = (parts: Partial<Engine>, maxUploadBytes?: number) =>
  createApp({
    engine: stubEngine({ ownVideosFolder: () => join(folder, 'my-videos'), ...parts }),
    jobs: new JobStore(),
    allowedHosts: [HOST],
    ...(maxUploadBytes === undefined ? {} : { maxUploadBytes }),
  });

interface Job {
  readonly status: string;
  readonly progress: BreakdownProgress | null;
  readonly result: BreakdownOutcome | null;
  readonly error: string | null;
}

describe('POST /api/breakdowns', () => {
  test('starts a breakdown as a job whose steps and outcome can be read', async () => {
    const asked: Array<[string, BreakdownChoices | undefined]> = [];
    let finish: (value: BreakdownOutcome) => void = () => {};
    const app = appWith({
      breakDown: (channel, report, choices) => {
        asked.push([channel, choices]);
        report({ step: 'reading', text: 'Reading the channel and its top videos', supply: [] });
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });

    const started = await post(app, '/api/breakdowns', { channel: CHANNEL_ID });
    const { jobId } = (await read<{ jobId: string }>(started)).data;
    await settle();
    const running = (await read<Job>(await get(app, `/api/jobs/${jobId}`))).data;
    finish(outcome);
    await settle();
    const done = (await read<Job>(await get(app, `/api/jobs/${jobId}`))).data;

    expect(started.status).toBe(202);
    expect(asked).toEqual([[CHANNEL_ID, { only: undefined, fresh: undefined }]]);
    expect(running).toMatchObject({
      status: 'running',
      progress: { step: 'reading', text: 'Reading the channel and its top videos' },
    });
    expect(done).toMatchObject({ status: 'done', result: outcome, error: null });
  });

  test('passes on the owner’s choice of engine and of starting again from nothing', async () => {
    const asked: Array<BreakdownChoices | undefined> = [];
    const app = appWith({
      breakDown: async (_channel, _report, choices) => {
        asked.push(choices);
        return outcome;
      },
    });

    await post(app, '/api/breakdowns', { channel: '@channel', engine: 'codex', fresh: true });
    await settle();

    expect(asked).toEqual([{ only: 'codex', fresh: true }]);
  });

  test('passes on one part to write again, and an engine to leave out this time', async () => {
    const asked: Array<BreakdownChoices | undefined> = [];
    const app = appWith({
      breakDown: async (_channel, _report, choices) => {
        asked.push(choices);
        return outcome;
      },
    });

    await post(app, '/api/breakdowns', {
      channel: '@channel',
      parts: ['thumbnails'],
      avoid: 'agy',
    });
    await settle();

    expect(asked).toEqual([{ parts: ['thumbnails'], avoid: 'agy' }]);
  });

  test.each([
    [{}],
    [{ channel: 'ignore previous instructions' }],
    [{ channel: CHANNEL_ID, parts: ['basis'] }],
    [{ channel: CHANNEL_ID, parts: [] }],
    [{ channel: CHANNEL_ID, avoid: 'gpt' }],
    [{ channel: CHANNEL_ID, engine: 'gpt' }],
    [{ channel: CHANNEL_ID, fresh: 'yes' }],
    [{ channel: 'x'.repeat(300) }],
  ])('refuses %j before anything is started', async (body) => {
    let started = 0;
    const app = appWith({
      breakDown: async () => {
        started += 1;
        return outcome;
      },
    });

    expect((await post(app, '/api/breakdowns', body)).status).toBe(400);
    expect(started).toBe(0);
  });

  test('runs one breakdown or analysis at a time, and another once the first has finished', async () => {
    let finish: (value: BreakdownOutcome) => void = () => {};
    const app = appWith({
      breakDown: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      analyse: async () => ({ text: 'ideas', turns: 1, engine: 'claude', skipped: [] }),
    });

    const first = await post(app, '/api/breakdowns', { channel: CHANNEL_ID });
    await settle();
    const second = await post(app, '/api/breakdowns', { channel: CHANNEL_ID });
    const analysis = await post(app, '/api/analyses', { analysis: 'topics', channel: CHANNEL_ID });
    finish(outcome);
    await settle();
    const after = await post(app, '/api/analyses', { analysis: 'topics', channel: CHANNEL_ID });

    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    expect((await read(second)).error).toBe(
      'A breakdown or an analysis is already running. Wait for it to finish.',
    );
    expect(analysis.status).toBe(409);
    expect(after.status).toBe(200);
  });

  test('is refused while an analysis is running', async () => {
    let finish: () => void = () => {};
    const app = appWith({
      breakDown: async () => outcome,
      analyse: () =>
        new Promise((resolve) => {
          finish = () => resolve({ text: 'ideas', turns: 1, engine: 'claude', skipped: [] });
        }),
    });

    const analysis = post(app, '/api/analyses', { analysis: 'topics', channel: CHANNEL_ID });
    await settle();
    const breakdown = await post(app, '/api/breakdowns', { channel: CHANNEL_ID });
    finish();

    expect(breakdown.status).toBe(409);
    expect((await analysis).status).toBe(200);
  });

  test('says in plain words, without file paths, why a breakdown failed, and frees the slot', async () => {
    const app = appWith({
      breakDown: async () => {
        throw new Error('None of the AI engines could answer. See /home/someone/log.txt');
      },
    });

    const { jobId } = (
      await read<{ jobId: string }>(await post(app, '/api/breakdowns', { channel: CHANNEL_ID }))
    ).data;
    await settle();
    const failed = (await read<Job>(await get(app, `/api/jobs/${jobId}`))).data;
    const again = await post(app, '/api/breakdowns', { channel: CHANNEL_ID });

    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('None of the AI engines could answer.');
    expect(failed.error).not.toContain('/home/someone');
    expect(again.status).toBe(202);
  });

  test('accepts only POST from this site, and the plain analysis route does not start one', async () => {
    const app = appWith({ breakDown: async () => outcome });

    const put = await app(
      new Request(`http://${HOST}/api/breakdowns`, { method: 'PUT', headers: { host: HOST } }),
    );
    expect(put.status).toBe(405);
    const crossSite = await post(
      app,
      '/api/breakdowns',
      { channel: CHANNEL_ID },
      { origin: 'https://evil.example' },
    );
    expect(crossSite.status).toBe(403);
    for (const analysis of ['breakdown', 'breakdown-titles', 'breakdown-master']) {
      const direct = await post(app, '/api/analyses', { analysis, channel: CHANNEL_ID });
      expect(direct.status).toBe(400);
    }
  });
});

describe('GET /api/breakdowns', () => {
  test('returns a channel’s stored breakdown without running anything', async () => {
    const asked: string[] = [];
    const app = appWith({
      findBreakdown: async (channel) => {
        asked.push(channel);
        return view;
      },
    });

    const response = await get(app, `/api/breakdowns?channel=${CHANNEL_ID}`);

    expect(response.status).toBe(200);
    expect((await read<BreakdownView>(response)).data).toEqual(view);
    expect(asked).toEqual([CHANNEL_ID]);
  });

  test('answers with nothing, and no failure, when no breakdown has been written for the channel', async () => {
    const app = appWith({ findBreakdown: async () => null });

    const response = await get(app, '/api/breakdowns?channel=@channel');

    expect(response.status).toBe(200);
    expect(await read<null>(response)).toMatchObject({ success: true, data: null, error: null });
  });

  test.each(['', 'not a channel!', `UC${'x'.repeat(300)}`])(
    'refuses %j as a channel, before the store is read',
    async (channel) => {
      const app = appWith({});

      const response = await get(app, `/api/breakdowns?channel=${encodeURIComponent(channel)}`);

      expect(response.status).toBe(400);
    },
  );

  test('answers only to its own address, and says so without file paths when the read fails', async () => {
    const app = appWith({
      findBreakdown: async () => {
        throw new Error('cannot open /home/owner/jgtube/store.db');
      },
    });

    const rebound = await get(app, `/api/breakdowns?channel=${CHANNEL_ID}`, 'evil.example');
    const failed = await get(app, `/api/breakdowns?channel=${CHANNEL_ID}`);

    expect(rebound.status).toBe(403);
    expect(failed.status).toBe(500);
    expect((await read<null>(failed)).error).not.toContain('/home/owner');
  });
});

describe('GET /api/breakdowns/texts/:name', () => {
  const channel = { id: CHANNEL_ID, title: 'Café “Été”' };
  const text = (name: string, body: string | null) => ({
    channel,
    file:
      body === null
        ? {
            id: 'master' as const,
            name,
            text: null,
            reason: 'The master prompt part has not been written.',
          }
        : { id: 'master' as const, name, text: body, reason: null },
  });

  test('hands over one of the four texts as a plain text file to save, named after the channel', async () => {
    const asked: Array<[string, string]> = [];
    const app = appWith({
      breakdownText: (ref, file) => {
        asked.push([ref, file]);
        return text('master-prompt.txt', 'Write a script. Mark [CHECK: ...].\n');
      },
    });

    const response = await get(
      app,
      `/api/breakdowns/texts/master-prompt.txt?channel=${CHANNEL_ID}`,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Write a script. Mark [CHECK: ...].\n');
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="Caf_ __t__ - master-prompt.txt"; filename*=UTF-8''Caf%C3%A9%20%E2%80%9C%C3%89t%C3%A9%E2%80%9D%20-%20master-prompt.txt`,
    );
    expect(asked).toEqual([[CHANNEL_ID, 'master']]);
  });

  test.each([
    ['breakdown.txt', 'whole'],
    ['production-plan.txt', 'plan'],
    ['thumbnail-prompt.txt', 'thumbnail'],
    ['master-prompt.txt', 'master'],
  ])('takes %s, and asks the store for the %s text', async (name, id) => {
    const asked: string[] = [];
    const app = appWith({
      breakdownText: (_ref, file) => {
        asked.push(file);
        return text(name, 'T');
      },
    });

    expect((await get(app, `/api/breakdowns/texts/${name}?channel=${CHANNEL_ID}`)).status).toBe(
      200,
    );
    expect(asked).toEqual([id]);
  });

  test.each(['index.json', '../store.db', 'master-prompt.txt.bak', ''])(
    'refuses %j: only the four fixed names are taken',
    async (name) => {
      const app = appWith({});

      const response = await get(
        app,
        `/api/breakdowns/texts/${encodeURIComponent(name)}?channel=${CHANNEL_ID}`,
      );

      expect(response.status).toBe(404);
    },
  );

  test('says why there is no such text, instead of an empty file', async () => {
    const app = appWith({ breakdownText: () => text('master-prompt.txt', null) });

    const response = await get(
      app,
      `/api/breakdowns/texts/master-prompt.txt?channel=${CHANNEL_ID}`,
    );

    expect(response.status).toBe(404);
    expect((await read<null>(response)).error).toBe('The master prompt part has not been written.');
  });

  test('refuses a channel that is not one, a channel not read yet, another address and anything but GET', async () => {
    const app = appWith({ breakdownText: () => null });
    const path = `/api/breakdowns/texts/breakdown.txt?channel=${CHANNEL_ID}`;

    expect((await get(app, '/api/breakdowns/texts/breakdown.txt?channel=nope!')).status).toBe(400);
    expect((await get(app, path)).status).toBe(404);
    expect((await get(app, path, 'evil.example')).status).toBe(403);
    expect((await post(app, path, {})).status).toBe(405);
  });
});

describe('PUT /api/breakdowns/videos/:videoId', () => {
  const put = (
    app: (request: Request) => Promise<Response>,
    videoId: string,
    body: BodyInit | Uint8Array | null,
    headers: Record<string, string> = {},
  ) => {
    const init: RequestInit & { duplex: 'half' } = {
      method: 'PUT',
      headers: { host: HOST, 'content-type': 'video/mp4', ...headers },
      // Node takes bytes as a body; the browser's type for it is narrower.
      body: body as BodyInit | null,
      duplex: 'half',
    };
    return app(new Request(`http://${HOST}/api/breakdowns/videos/${videoId}`, init));
  };
  const mine = () => join(folder, 'my-videos');
  const saved = (): readonly string[] => (existsSync(mine()) ? readdirSync(mine()) : []);

  /** A body that arrives in pieces, with a pause the test controls before the last one. */
  function slowBody(bytes: Uint8Array) {
    let release: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(bytes.subarray(0, 10));
        await waiting;
        controller.enqueue(bytes.subarray(10));
        controller.close();
      },
    });
    return { stream, release };
  }

  test('saves a whole MP4 under the video’s id and says how big it is and where', async () => {
    const app = appWith({});
    const bytes = tinyMp4();

    const response = await put(app, VIDEO, bytes);

    expect(response.status).toBe(201);
    expect((await read(response)).data).toEqual({
      video: VIDEO,
      bytes: bytes.length,
      file: `${VIDEO}.mp4`,
      folder: mine(),
    });
    expect(saved()).toEqual([`${VIDEO}.mp4`]);
    expect(readFileSync(join(mine(), `${VIDEO}.mp4`))).toEqual(bytes);
  });

  test('takes a file for a video whose id begins with a dash', async () => {
    const response = await put(appWith({}), '-aaaaaaaaaa', tinyMp4());

    expect(response.status).toBe(201);
    expect(saved()).toEqual(['-aaaaaaaaaa.mp4']);
  });

  test('replaces an earlier file for the same video', async () => {
    const app = appWith({});
    await put(app, VIDEO, tinyMp4());
    const longer = Buffer.concat([tinyMp4().subarray(0, 20), tinyMp4().subarray(20)]);

    expect((await put(app, VIDEO, longer)).status).toBe(201);
    expect(saved()).toEqual([`${VIDEO}.mp4`]);
  });

  test.each([
    ['../../etc/passwd'],
    ['short'],
    ['has a space!'],
    [`${VIDEO}.mp4`],
    [`${VIDEO}/more`],
  ])('refuses the id %j before it touches a path', async (videoId) => {
    const response = await put(appWith({}), encodeURIComponent(videoId), tinyMp4());

    expect(response.status).toBe(400);
    expect((await read(response)).error).toBe('That is not a YouTube video id.');
    expect(saved()).toEqual([]);
  });

  test.each(['video/webm', 'application/json', 'application/octet-stream'])(
    'refuses a file sent as %s',
    async (type) => {
      const response = await put(appWith({}), VIDEO, tinyMp4(), { 'content-type': type });

      expect(response.status).toBe(415);
      expect(saved()).toEqual([]);
    },
  );

  test('refuses a file that says it is over the size limit without reading it', async () => {
    const response = await put(appWith({}, 1000), VIDEO, tinyMp4(), { 'content-length': '5000' });

    expect(response.status).toBe(413);
    expect((await read(response)).error).toBe(
      'That file is larger than the 0 MB a video file may be.',
    );
    expect(saved()).toEqual([]);
  });

  test('stops a file that turns out larger than it said, and leaves nothing behind', async () => {
    const big = Buffer.concat([tinyMp4(), Buffer.alloc(4000)]);

    const response = await put(appWith({}, 1000), VIDEO, big, { 'content-length': '10' });

    expect(response.status).toBe(413);
    expect(saved()).toEqual([]);
  });

  test('refuses a file that was cut short or is not a video, and leaves nothing behind', async () => {
    const app = appWith({});

    const cutShort = await put(app, VIDEO, tinyMp4().subarray(0, 30));
    const notVideo = await put(app, VIDEO, Buffer.from('just some text, not a video at all'));

    expect(cutShort.status).toBe(400);
    expect((await read(cutShort)).error).toBe(
      'That file is not a complete MP4 video. It may have been cut short, or be another kind of file.',
    );
    expect(notVideo.status).toBe(400);
    expect(saved()).toEqual([]);
  });

  test('leaves an earlier good file in place when a later one is refused', async () => {
    const app = appWith({});
    await put(app, VIDEO, tinyMp4());

    await put(app, VIDEO, tinyMp4().subarray(0, 30));

    expect(readFileSync(join(mine(), `${VIDEO}.mp4`))).toEqual(tinyMp4());
    expect(saved()).toEqual([`${VIDEO}.mp4`]);
  });

  test('refuses an empty body and a request with none', async () => {
    const app = appWith({});

    expect((await put(app, VIDEO, new Uint8Array())).status).toBe(400);
    expect((await put(app, VIDEO, null)).status).toBe(400);
    expect(saved()).toEqual([]);
  });

  test('removes the part that arrived when the connection drops', async () => {
    const dropped = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(tinyMp4().subarray(0, 12));
        controller.error(new Error('the connection was reset at /home/owner/x'));
      },
    });

    const response = await put(appWith({}), VIDEO, dropped);

    expect(response.status).toBe(400);
    expect((await read(response)).error).toMatch(/^The file did not arrive whole/);
    expect((await read(await put(appWith({}), VIDEO, tinyMp4()))).success).toBe(true);
    expect(saved()).toEqual([`${VIDEO}.mp4`]);
  });

  test('takes one file at a time, and the next once the first has arrived', async () => {
    const app = appWith({});
    const slow = slowBody(tinyMp4());

    const first = put(app, VIDEO, slow.stream);
    await settle();
    const second = await put(app, 'aaaaaaaaaaa', tinyMp4());
    slow.release();

    expect(second.status).toBe(409);
    expect((await first).status).toBe(201);
    expect((await put(app, 'aaaaaaaaaaa', tinyMp4())).status).toBe(201);
    expect([...saved()].sort()).toEqual(['aaaaaaaaaaa.mp4', `${VIDEO}.mp4`]);
  });

  test('refuses a file from another site, and any way of asking but PUT', async () => {
    const app = appWith({});

    const foreign = await put(app, VIDEO, tinyMp4(), { origin: 'https://evil.example' });
    const wrongHost = await put(app, VIDEO, tinyMp4(), { host: 'evil.example' });

    expect(foreign.status).toBe(403);
    expect(wrongHost.status).toBe(403);
    expect((await get(app, `/api/breakdowns/videos/${VIDEO}`)).status).toBe(405);
    expect(saved()).toEqual([]);
  });

  test('says there is nowhere to save when the store is only in memory', async () => {
    const app = appWith({
      ownVideosFolder: () => {
        throw new Error('This store is only in memory. Set JGTUBE_DOWNLOADS_PATH.');
      },
    });

    const response = await put(app, VIDEO, tinyMp4());

    expect(response.status).toBe(400);
    expect((await read(response)).error).toContain('JGTUBE_DOWNLOADS_PATH');
  });

  test('does not write over a file that is not its own', async () => {
    const app = appWith({});
    await put(app, VIDEO, tinyMp4());
    writeFileSync(join(mine(), 'notes.txt'), 'the owner’s own notes');

    await put(app, VIDEO, tinyMp4().subarray(0, 30));

    expect(readFileSync(join(mine(), 'notes.txt'), 'utf8')).toBe('the owner’s own notes');
  });
});

describe('POST /api/transcripts/download', () => {
  const saved: TranscriptDownload = {
    channelId: CHANNEL_ID,
    channelTitle: 'Channel',
    folder: '/home/owner/jgtube/downloads/transcripts/UCx',
    indexFile: '/home/owner/jgtube/downloads/transcripts/UCx/index.json',
    saved: [
      {
        videoId: VIDEO,
        title: 'A video',
        views: 9000,
        score: 4,
        file: `${VIDEO}.txt`,
        language: 'en',
        autoGenerated: true,
        words: 1200,
      },
    ],
    noCaptions: [{ videoId: 'aaaaaaaaaaa', title: 'Silent' }],
    failed: [],
  };

  test('saves the channel’s transcripts and says where they are', async () => {
    const asked: string[] = [];
    const app = appWith({
      saveTranscripts: async (channel) => {
        asked.push(channel);
        return saved;
      },
    });

    const response = await post(app, '/api/transcripts/download', { channel: CHANNEL_ID });

    expect(response.status).toBe(200);
    expect((await read(response)).data).toEqual({
      channel: CHANNEL_ID,
      folder: saved.folder,
      indexFile: saved.indexFile,
      saved: 1,
      noCaptions: 1,
      failed: 0,
    });
    expect(asked).toEqual([CHANNEL_ID]);
  });

  test('refuses anything but a channel id, and says so for a channel not read yet', async () => {
    const app = appWith({ saveTranscripts: async () => null });

    expect((await post(app, '/api/transcripts/download', { channel: '../../etc' })).status).toBe(
      400,
    );
    expect((await post(app, '/api/transcripts/download', { channel: CHANNEL_ID })).status).toBe(
      404,
    );
    expect((await get(app, '/api/transcripts/download')).status).toBe(405);
  });

  test('says so, without file paths, when the transcripts cannot be saved', async () => {
    const app = appWith({
      saveTranscripts: async () => {
        throw new Error('EACCES: permission denied, mkdir /home/owner/jgtube/downloads');
      },
    });

    const response = await post(app, '/api/transcripts/download', { channel: CHANNEL_ID });

    expect(response.status).toBe(500);
    expect((await read(response)).error).not.toContain('/home/owner');
  });
});

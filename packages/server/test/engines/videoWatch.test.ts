import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { GeminiFetch } from '../../src/engines/geminiVideo';
import type { EngineSettings } from '../../src/engines/settings';
import {
  watchVideo,
  type DownloadVideo,
  type VideoWatchContext,
} from '../../src/engines/videoWatch';
import { scripted, tinyMp4, type Scripted } from './standIn';

const VIDEO_ID = 'dQw4w9WgXcQ';
const KEY = 'AIzaSyD-stand-in-key-0123456789abcdef';
const video = {
  videoId: VIDEO_ID,
  question: 'Describe the transitions.',
  systemPrompt: 'You are a YouTube analyst.',
};
const withKey = { gemini: { apiKey: KEY, model: 'gemini-4-hydrogen' } };

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-watch-test-'));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

/** A downloader that hands back a stand-in file, and remembers what it was asked for. */
function downloader(bytes: Buffer = tinyMp4()) {
  const asked: string[] = [];
  const download: DownloadVideo = async (videoId) => {
    asked.push(videoId);
    const path = join(folder, `${videoId}.mp4`);
    writeFileSync(path, bytes);
    return { ok: true, path };
  };
  return { asked, download };
}

const gemini = (text: string) => {
  const asked: string[] = [];
  const fetch: GeminiFetch = async (_url, init) => {
    asked.push(init.body);
    return new Response(
      JSON.stringify({
        status: 'completed',
        steps: [{ type: 'model_output', content: [{ type: 'text', text }] }],
      }),
    );
  };
  return { asked, fetch };
};

interface Setup {
  readonly settings?: Partial<EngineSettings>;
  readonly agy?: Scripted;
  readonly installed?: boolean;
  readonly download?: DownloadVideo;
  readonly geminiFetch?: GeminiFetch;
}

function setup({ settings = {}, agy = {}, installed = true, download, geminiFetch }: Setup) {
  const { started, deps } = scripted(() => agy);
  const context: VideoWatchContext = {
    settings: { order: ['agy', 'claude', 'codex'], agyYouTubeLinks: false, ...settings },
    deps,
    workDir: join(folder, 'work'),
    agyInstalled: async () => installed,
    download,
    geminiFetch,
  };
  return { started, context };
}

const agySays = (response: string): Scripted => ({
  stdout: JSON.stringify({ status: 'SUCCESS', response }),
});

describe('watchVideo', () => {
  test('has Antigravity watch a downloaded copy when it is installed', async () => {
    const { asked, download } = downloader();
    const google = gemini('never');
    const { started, context } = setup({
      settings: withKey,
      agy: agySays('Cuts every two seconds.'),
      download,
      geminiFetch: google.fetch,
    });

    await expect(watchVideo(video, context)).resolves.toEqual({
      text: 'Cuts every two seconds.',
      turns: null,
      engine: 'agy',
      skipped: [],
    });
    expect(asked).toEqual([VIDEO_ID]);
    expect(started[0]?.args[1]).toContain('@clip.mp4');
    expect(started[0]?.args[started[0].args.indexOf('--print-timeout') + 1]).toBe('12m');
    expect(google.asked).toEqual([]);
  });

  test('uses the Gemini API when Antigravity is not installed, and downloads nothing', async () => {
    const { asked, download } = downloader();
    const google = gemini('A whoosh on each cut.');
    const { started, context } = setup({
      settings: withKey,
      installed: false,
      download,
      geminiFetch: google.fetch,
    });

    await expect(watchVideo(video, context)).resolves.toMatchObject({
      text: 'A whoosh on each cut.',
      engine: 'gemini-api',
      skipped: [{ engine: 'agy', reason: 'not-installed' }],
    });
    expect(asked).toEqual([]);
    expect(started).toEqual([]);
    expect(google.asked[0]).toContain(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
  });

  test.each([
    ['there is no downloader yet', undefined, /cannot download videos yet/],
    [
      'the download failed',
      (async () => ({ ok: false, reason: 'YouTube refused the download' })) as DownloadVideo,
      /YouTube refused the download/,
    ],
    [
      'the download stopped part-way',
      downloader(tinyMp4().subarray(0, 30)).download,
      /not a complete MP4/,
    ],
  ])('uses the Gemini API when %s', async (_, download, why) => {
    const { started, context } = setup({
      settings: withKey,
      download,
      geminiFetch: gemini('From Gemini.').fetch,
    });

    const answer = await watchVideo(video, context);

    expect(answer).toMatchObject({ text: 'From Gemini.', engine: 'gemini-api' });
    expect(answer.skipped).toEqual([
      { engine: 'agy', reason: 'failed', message: expect.stringMatching(why) },
    ]);
    expect(started).toEqual([]);
  });

  test('moves on to the Gemini API when nobody is signed in to Antigravity', async () => {
    const { context } = setup({
      settings: withKey,
      agy: { stderr: 'authentication required', code: 1 },
      download: downloader().download,
      geminiFetch: gemini('From Gemini.').fetch,
    });

    await expect(watchVideo(video, context)).resolves.toMatchObject({
      engine: 'gemini-api',
      skipped: [{ engine: 'agy', reason: 'not-signed-in' }],
    });
  });

  test('reports Antigravity running out of time instead of spending the key on the same video', async () => {
    const google = gemini('never');
    const { context } = setup({
      settings: withKey,
      agy: { stdout: JSON.stringify({ status: 'ERROR', error: 'timed out' }), code: 3 },
      download: downloader().download,
      geminiFetch: google.fetch,
    });

    await expect(watchVideo(video, context)).rejects.toMatchObject({ reason: 'timeout' });
    expect(google.asked).toEqual([]);
  });

  test('leaves Antigravity out entirely when the owner’s settings do', async () => {
    const { asked, download } = downloader();
    const { started, context } = setup({
      settings: { ...withKey, order: ['claude'] },
      download,
      geminiFetch: gemini('From Gemini.').fetch,
    });

    await expect(watchVideo(video, context)).resolves.toMatchObject({
      engine: 'gemini-api',
      skipped: [],
    });
    expect(asked).toEqual([]);
    expect(started).toEqual([]);
  });

  test('does not mention the Gemini API when Antigravity answered', async () => {
    const { context } = setup({ agy: agySays('ok'), download: downloader().download });

    await expect(watchVideo(video, context)).resolves.toMatchObject({ engine: 'agy', skipped: [] });
  });

  test('says no engine can watch video, and why for each, when neither can', async () => {
    const { context } = setup({ installed: false });

    await expect(watchVideo(video, context)).rejects.toMatchObject({
      reason: 'not-installed',
      message: expect.stringMatching(
        /^No engine on this computer can watch a video\. .*not installed.*GEMINI_API_KEY/,
      ),
      skipped: [{ engine: 'agy' }, { engine: 'gemini-api' }],
    });
  });

  test('asks Antigravity about the link only when the owner has turned that on', async () => {
    const { started, context } = setup({
      settings: { agyYouTubeLinks: true },
      agy: agySays('The first sentence spoken is "Hello".'),
    });

    await expect(watchVideo(video, context)).resolves.toMatchObject({ engine: 'agy' });
    expect(started[0]?.args[1]).toContain(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
  });

  test('refuses something that is not a video id before anything is downloaded', async () => {
    const { asked, download } = downloader();
    const { context } = setup({ download });

    await expect(
      watchVideo({ ...video, videoId: '../../etc/passwd' }, context),
    ).rejects.toMatchObject({ reason: 'failed', message: expect.stringMatching(/video id/) });
    expect(asked).toEqual([]);
  });
});

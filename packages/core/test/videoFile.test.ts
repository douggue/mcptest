import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { builtInVideoFetcher, chooseMuxedFormat } from '../src/downloads/builtInVideo';
import { downloadVideo } from '../src/downloads/video';
import {
  MAX_VIDEO_BYTES,
  VIDEO_MIN_HEIGHT,
  VIDEO_TEMP_MAX_AGE_HOURS,
  cleanVideoTemp,
  downloadVideoFile,
  removeVideoFile,
  videoTempFolder,
  type VideoDownload,
  type VideoFetcher,
} from '../src/downloads/videoFile';
import {
  findProgram,
  ytDlpArguments,
  ytDlpFetcher,
  type ProgramResult,
} from '../src/downloads/ytDlp';

const NOW = new Date('2026-11-20T12:00:00Z');
const HOUR_MS = 3_600_000;
const VIDEO = 'wE5ETbiq1qQ';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-video-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const tempFolder = (): string => {
  const folder = join(root, 'video-temp');
  mkdirSync(folder, { recursive: true });
  return folder;
};

/** A fetcher that writes a small file, or gives the answer a test hands it. */
function fakeFetcher(
  route: VideoFetcher['route'],
  answer?: VideoDownload,
): VideoFetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    route,
    calls,
    async fetch(videoId, folder) {
      calls.push(videoId);
      if (answer) return answer;
      const path = join(folder, `${videoId}.mp4`);
      writeFileSync(path, 'video bytes');
      return { ok: true, path, bytes: 11, durationSeconds: 948, format: '360p mp4', via: route };
    },
  };
}

describe('downloadVideoFile', () => {
  test('keeps the limits it works by as named numbers', () => {
    expect([MAX_VIDEO_BYTES, VIDEO_TEMP_MAX_AGE_HOURS, VIDEO_MIN_HEIGHT]).toEqual([
      95_000_000, 24, 240,
    ]);
    expect(MAX_VIDEO_BYTES).toBeLessThan(100 * 1024 * 1024);
  });

  test('fetches the file into the temporary folder and says which way was used', async () => {
    const fetcher = fakeFetcher('yt-dlp');

    const result = await downloadVideoFile({ fetchers: [fetcher], now: () => NOW }, VIDEO, root);

    expect(result).toEqual({
      ok: true,
      path: join(root, 'video-temp', `${VIDEO}.mp4`),
      bytes: 11,
      durationSeconds: 948,
      format: '360p mp4',
      via: 'yt-dlp',
    });
    expect(readdirSync(join(root, 'video-temp'))).toEqual([`${VIDEO}.mp4`]);
  });

  test('hands over to the next way when the first cannot read the video', async () => {
    const broken = fakeFetcher('yt-dlp', {
      ok: false,
      kind: 'unreadable',
      message: 'yt-dlp could not fetch it',
      via: 'yt-dlp',
    });
    const builtIn = fakeFetcher('built-in');

    const result = await downloadVideoFile(
      { fetchers: [broken, builtIn], now: () => NOW },
      VIDEO,
      root,
    );

    expect(result).toMatchObject({ ok: true, via: 'built-in' });
    expect(broken.calls).toEqual([VIDEO]);
  });

  test.each(['not-available', 'too-large'] as const)(
    'takes "%s" as the answer and does not try another way',
    async (kind) => {
      const first = fakeFetcher('yt-dlp', { ok: false, kind, message: 'no', via: 'yt-dlp' });
      const second = fakeFetcher('built-in');

      const result = await downloadVideoFile(
        { fetchers: [first, second], now: () => NOW },
        VIDEO,
        root,
      );

      expect(result).toMatchObject({ ok: false, kind, via: 'yt-dlp' });
      expect(second.calls).toEqual([]);
    },
  );

  test('gives the last failure when no way could read the video, and says so when there is none', async () => {
    const failed = (via: VideoFetcher['route']): VideoDownload => ({
      ok: false,
      kind: 'unreadable',
      message: `${via} failed`,
      via,
    });
    const both = [
      fakeFetcher('yt-dlp', failed('yt-dlp')),
      fakeFetcher('built-in', failed('built-in')),
    ];

    expect(await downloadVideoFile({ fetchers: both, now: () => NOW }, VIDEO, root)).toMatchObject({
      message: 'built-in failed',
    });
    expect(await downloadVideoFile({ fetchers: [], now: () => NOW }, VIDEO, root)).toEqual({
      ok: false,
      kind: 'unreadable',
      message: 'Jgtube has no way to fetch a video file on this computer.',
      via: null,
    });
  });

  test('refuses anything that is not a video id before touching the disk', async () => {
    const fetcher = fakeFetcher('yt-dlp');

    await expect(
      downloadVideoFile({ fetchers: [fetcher], now: () => NOW }, '../../outside', root),
    ).rejects.toThrow(/video id/);
    expect(readdirSync(root)).toEqual([]);
  });

  test('removes copies left over from more than a day ago before it starts', async () => {
    const folder = tempFolder();
    const old = join(folder, 'aaaaaaaaaaa.mp4');
    const recent = join(folder, 'bbbbbbbbbbb.mp4');
    writeFileSync(old, 'old');
    writeFileSync(recent, 'recent');
    const longAgo = new Date(NOW.getTime() - 25 * HOUR_MS);
    const justNow = new Date(NOW.getTime() - HOUR_MS);
    utimesSync(old, longAgo, longAgo);
    utimesSync(recent, justNow, justNow);

    await downloadVideoFile({ fetchers: [fakeFetcher('yt-dlp')], now: () => NOW }, VIDEO, root);

    expect(readdirSync(folder).sort()).toEqual(['bbbbbbbbbbb.mp4', `${VIDEO}.mp4`]);
  });
});

describe('housekeeping', () => {
  test('cleaning an area that does not exist yet removes nothing', async () => {
    expect(await cleanVideoTemp(root, NOW)).toBe(0);
  });

  test('deletes a copy after use, and only inside the temporary folder', async () => {
    const folder = tempFolder();
    const copy = join(folder, `${VIDEO}.mp4`);
    const elsewhere = join(root, 'keep.txt');
    writeFileSync(copy, 'x');
    writeFileSync(elsewhere, 'x');

    await removeVideoFile(root, copy);
    await removeVideoFile(root, `${VIDEO}.gone`);

    expect(existsSync(copy)).toBe(false);
    await expect(removeVideoFile(root, elsewhere)).rejects.toThrow(/outside/);
    await expect(removeVideoFile(root, join(folder, '..', '..', 'x'))).rejects.toThrow(/outside/);
    expect(existsSync(elsewhere)).toBe(true);
    expect(videoTempFolder(root)).toBe(folder);
  });
});

describe('findProgram', () => {
  const bin = (name: string, mode = 0o755): string => {
    const folder = mkdtempSync(join(root, 'bin-'));
    writeFileSync(join(folder, name), '#!/bin/sh\n');
    chmodSync(join(folder, name), mode);
    return folder;
  };

  test('finds a program in a folder on the PATH and gives its full path', async () => {
    const folder = bin('yt-dlp');
    const env = { PATH: [join(root, 'empty'), folder].join(delimiter) };

    expect(await findProgram('yt-dlp', env, 'linux')).toBe(join(folder, 'yt-dlp'));
  });

  test('looks for the .exe on Windows, whatever the PATH variable is called there', async () => {
    const folder = bin('yt-dlp.exe', 0o644);

    expect(await findProgram('yt-dlp', { Path: folder }, 'win32')).toBe(join(folder, 'yt-dlp.exe'));
    expect(await findProgram('yt-dlp', { Path: bin('yt-dlp') }, 'win32')).toBeNull();
  });

  test('finds nothing when it is not installed, not a program, or the PATH is empty', async () => {
    expect(await findProgram('yt-dlp', { PATH: bin('other') }, 'linux')).toBeNull();
    expect(await findProgram('yt-dlp', { PATH: bin('yt-dlp', 0o644) }, 'linux')).toBeNull();
    expect(await findProgram('yt-dlp', {}, 'linux')).toBeNull();
    mkdirSync(join(root, 'dir', 'yt-dlp'), { recursive: true });
    expect(await findProgram('yt-dlp', { PATH: join(root, 'dir') }, 'linux')).toBeNull();
  });

  test('never searches a folder that is not a full path, such as the current one', async () => {
    expect(
      await findProgram('yt-dlp', { PATH: ['.', '', 'bin'].join(delimiter) }, 'linux'),
    ).toBeNull();
  });
});

describe('the yt-dlp route', () => {
  const PROGRAM = '/usr/local/bin/yt-dlp';
  const ok = (stdout: string): ProgramResult => ({ code: 0, stdout, stderr: '' });

  test('starts yt-dlp with a list of arguments that keeps every file in the folder', () => {
    const args = ytDlpArguments(VIDEO, '/data/downloads/video-temp', 95_000_000);

    expect(args).toEqual([
      '--no-playlist',
      '--no-progress',
      '--no-warnings',
      '--no-part',
      '--no-simulate',
      '--format',
      'worst[height>=240][vcodec!=none][acodec!=none]',
      '--max-filesize',
      '95000000',
      '--paths',
      '/data/downloads/video-temp',
      '--output',
      `${VIDEO}.%(ext)s`,
      '--print',
      'after_move:%(duration)s|%(height)s|%(ext)s|%(format_id)s',
      '--',
      `https://www.youtube.com/watch?v=${VIDEO}`,
    ]);
  });

  test('reports the file yt-dlp wrote, with its length and format', async () => {
    const folder = tempFolder();
    const started: Array<[string, readonly string[]]> = [];
    const fetcher = ytDlpFetcher(PROGRAM, async (program, args) => {
      started.push([program, args]);
      writeFileSync(join(folder, `${VIDEO}.mp4`), 'x'.repeat(2048));
      return ok('948|360|mp4|18\n');
    });

    const result = await fetcher.fetch(VIDEO, folder, MAX_VIDEO_BYTES);

    expect(result).toEqual({
      ok: true,
      path: join(folder, `${VIDEO}.mp4`),
      bytes: 2048,
      durationSeconds: 948,
      format: '360p mp4',
      via: 'yt-dlp',
    });
    expect(started[0]?.[0]).toBe(PROGRAM);
    expect(started[0]?.[1].at(-1)).toBe(`https://www.youtube.com/watch?v=${VIDEO}`);
  });

  test('says the video is too large when yt-dlp skipped it for its size', async () => {
    const result = await ytDlpFetcher(PROGRAM, async () => ok('')).fetch(
      VIDEO,
      tempFolder(),
      MAX_VIDEO_BYTES,
    );

    expect(result).toEqual({
      ok: false,
      kind: 'too-large',
      message: 'The video is larger than the 95 MB a file may be.',
      via: 'yt-dlp',
    });
  });

  test('removes a file that came out over the limit', async () => {
    const folder = tempFolder();
    const fetcher = ytDlpFetcher(PROGRAM, async () => {
      writeFileSync(join(folder, `${VIDEO}.mp4`), 'x'.repeat(200));
      return ok('948|360|mp4|18');
    });

    expect(await fetcher.fetch(VIDEO, folder, 100)).toMatchObject({ kind: 'too-large' });
    expect(readdirSync(folder)).toEqual([]);
  });

  test.each([
    ['ERROR: [youtube] wE5ETbiq1qQ: Video unavailable. This video is private', 'not-available'],
    ['ERROR: [youtube] wE5ETbiq1qQ: Sign in to confirm your age', 'not-available'],
    ['ERROR: [youtube] wE5ETbiq1qQ: Requested format is not available', 'not-available'],
    ['ERROR: unable to download video data: HTTP Error 403: Forbidden', 'unreadable'],
  ])('reads "%s" as %s, and leaves nothing behind', async (stderr, kind) => {
    const folder = tempFolder();
    const fetcher = ytDlpFetcher(PROGRAM, async () => {
      writeFileSync(join(folder, `${VIDEO}.mp4`), 'half a file');
      return { code: 1, stdout: '', stderr: `\n${stderr}\nmore` };
    });

    const result = await fetcher.fetch(VIDEO, folder, MAX_VIDEO_BYTES);

    expect(result).toMatchObject({ ok: false, kind, via: 'yt-dlp' });
    expect(result.ok ? '' : result.message).not.toContain('ERROR:');
    expect(readdirSync(folder)).toEqual([]);
  });

  test('says so when yt-dlp ran out of time or wrote nothing', async () => {
    const folder = tempFolder();
    const stopped = ytDlpFetcher(PROGRAM, async () => ({ code: null, stdout: '', stderr: '' }));
    const empty = ytDlpFetcher(PROGRAM, async () => {
      writeFileSync(join(folder, `${VIDEO}.mp4`), '');
      return ok('948|360|mp4|18');
    });

    expect(await stopped.fetch(VIDEO, folder, MAX_VIDEO_BYTES)).toMatchObject({
      kind: 'unreadable',
      message: 'yt-dlp took too long and was stopped.',
    });
    expect(await empty.fetch(VIDEO, folder, MAX_VIDEO_BYTES)).toMatchObject({
      kind: 'unreadable',
      message: 'yt-dlp wrote an empty file.',
    });
  });

  test('never starts yt-dlp for something that is not a video id', async () => {
    let started = 0;
    const fetcher = ytDlpFetcher(PROGRAM, async () => {
      started += 1;
      return ok('');
    });

    await expect(fetcher.fetch('--exec=rm', tempFolder(), 1)).rejects.toThrow(/video id/);
    expect(started).toBe(0);
  });
});

const BYTES = new Uint8Array(4096).fill(7);

function streamOf(...chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

const muxed = (overrides: Record<string, unknown> = {}) => ({
  itag: 18,
  mime_type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
  height: 360,
  bitrate: 500_000,
  content_length: BYTES.byteLength,
  has_audio: true,
  has_video: true,
  ...overrides,
});

function player(overrides: Record<string, unknown> = {}) {
  const asked: Array<Record<string, unknown>> = [];
  return {
    asked,
    playability_status: { status: 'OK' },
    basic_info: { duration: 948 },
    streaming_data: { formats: [muxed()], adaptive_formats: [{ itag: 137, has_video: true }] },
    async download(options: Record<string, unknown>) {
      asked.push(options);
      return streamOf(BYTES.slice(0, 1000), BYTES.slice(1000));
    },
    ...overrides,
  };
}

describe('the built-in route', () => {
  const fetchWith = (answer: unknown, maxBytes = MAX_VIDEO_BYTES) =>
    builtInVideoFetcher({ fetchPlayer: async () => answer }).fetch(VIDEO, tempFolder(), maxBytes);

  test('picks the smallest single file with picture and sound and fetches it with the library', async () => {
    const answer = player();

    const result = await fetchWith(answer);

    expect(result).toEqual({
      ok: true,
      path: join(root, 'video-temp', `${VIDEO}.mp4`),
      bytes: 4096,
      durationSeconds: 948,
      format: '360p mp4',
      via: 'built-in',
    });
    expect(answer.asked).toEqual([{ itag: 18, type: 'video+audio', format: 'any' }]);
    expect(new Uint8Array(readFileSync(result.ok ? result.path : ''))).toEqual(BYTES);
  });

  test('chooses by size when the player gives one, and never a file under 240 lines or without sound', () => {
    const formats = [
      muxed({ itag: 22, height: 720, content_length: 9_000_000 }),
      muxed({ itag: 18, height: 360, content_length: 3_000_000 }),
      muxed({ itag: 17, height: 144, content_length: 500_000 }),
      muxed({ itag: 134, height: 360, has_audio: false, content_length: 100 }),
    ];

    expect(chooseMuxedFormat({ formats }, 948)).toMatchObject({ itag: 18, container: 'mp4' });
    expect(chooseMuxedFormat({ formats: formats.slice(2) }, 948)).toBeNull();
    expect(chooseMuxedFormat(undefined, null)).toBeNull();
  });

  test('estimates a size from the bitrate and the length when the player gives none', () => {
    const format = chooseMuxedFormat({ formats: [muxed({ content_length: undefined })] }, 948);

    expect(format).toMatchObject({ exactBytes: null, bytes: 59_250_000 });
  });

  test('refuses a video whose smallest copy is over the limit, before fetching a byte', async () => {
    const answer = player({
      streaming_data: { formats: [muxed({ content_length: 131_000_000, bitrate: 600_000 })] },
    });

    const result = await fetchWith(answer);

    expect(result).toEqual({
      ok: false,
      kind: 'too-large',
      message:
        'The smallest watchable copy, 360p (about 131 MB), is over the 95 MB a file may be. Only about the first 21 minutes would fit.',
      via: 'built-in',
      fitsSeconds: 1266,
    });
    expect(answer.asked).toEqual([]);
    expect(readdirSync(join(root, 'video-temp'))).toEqual([]);
  });

  test('stops and removes the file when more arrives than the limit allows', async () => {
    const answer = player({
      streaming_data: { formats: [muxed({ content_length: undefined, bitrate: undefined })] },
    });

    const result = await fetchWith(answer, 2000);

    expect(result).toMatchObject({ ok: false, kind: 'too-large' });
    expect(readdirSync(join(root, 'video-temp'))).toEqual([]);
  });

  test('does not hand over a file that is not whole', async () => {
    const short = player({ download: async () => streamOf(BYTES.slice(0, 1000)) });
    const empty = player({ download: async () => streamOf() });

    expect(await fetchWith(short)).toMatchObject({
      ok: false,
      kind: 'unreadable',
      message: 'The download ended early: 1000 of 4096 bytes arrived.',
    });
    expect(await fetchWith(empty)).toMatchObject({ message: 'YouTube sent an empty file.' });
    expect(readdirSync(join(root, 'video-temp'))).toEqual([]);
  });

  test.each([
    [{ status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' }, 'not-available'],
    [{ status: 'ERROR', reason: 'This video is unavailable' }, 'not-available'],
    [{ status: 'UNPLAYABLE', reason: 'The page needs to be reloaded.' }, 'unreadable'],
  ])('reads the player’s refusal %j as %s', async (playability_status, kind) => {
    expect(await fetchWith(player({ playability_status }))).toMatchObject({ ok: false, kind });
  });

  test('says so when the player offers no single file, or the library cannot download', async () => {
    const none = player({ streaming_data: { formats: [] } });
    const noCall = player({ download: undefined });

    expect(await fetchWith(none)).toMatchObject({ kind: 'not-available' });
    expect(await fetchWith(noCall)).toMatchObject({
      kind: 'unreadable',
      message: 'The YouTube library has no download call for this video.',
    });
  });

  test('turns a failed request into a plain sentence and leaves nothing behind', async () => {
    const failing = player({
      download: async () => {
        throw new Error('The server responded with a non 2xx status code\n  at fetch');
      },
    });

    const result = await fetchWith(failing);

    expect(result).toMatchObject({
      ok: false,
      kind: 'unreadable',
      message:
        'The file could not be fetched: The server responded with a non 2xx status code. YouTube often refuses this way of fetching; installing yt-dlp is the fix.',
    });
    expect(readdirSync(join(root, 'video-temp'))).toEqual([]);
  });
});

describe('downloadVideo', () => {
  test('uses yt-dlp when it is installed, started by its full path', async () => {
    const bin = mkdtempSync(join(root, 'bin-'));
    writeFileSync(join(bin, 'yt-dlp'), '');
    chmodSync(join(bin, 'yt-dlp'), 0o755);
    const started: string[] = [];

    const result = await downloadVideo(`https://youtu.be/${VIDEO}`, {
      root,
      now: () => NOW,
      env: { PATH: bin },
      platform: 'linux',
      run: async (program, args) => {
        started.push(program);
        writeFileSync(join(args[args.indexOf('--paths') + 1] ?? '', `${VIDEO}.mp4`), 'video');
        return { code: 0, stdout: '948|360|mp4|18', stderr: '' };
      },
      source: { fetchPlayer: async () => player() },
    });

    expect(result).toMatchObject({ ok: true, via: 'yt-dlp', bytes: 5 });
    expect(started).toEqual([join(bin, 'yt-dlp')]);
  });

  test('uses the built-in route when yt-dlp is not installed', async () => {
    const result = await downloadVideo(VIDEO, {
      root,
      now: () => NOW,
      env: { PATH: '' },
      source: { fetchPlayer: async () => player() },
    });

    expect(result).toMatchObject({ ok: true, via: 'built-in' });
  });

  test('says there is no way to fetch a file when neither route is there', async () => {
    expect(await downloadVideo(VIDEO, { root, env: {} })).toMatchObject({ ok: false, via: null });
    await expect(downloadVideo('not a video', { root, env: {} })).rejects.toThrow(
      /Not a valid YouTube video id or link/,
    );
  });
});

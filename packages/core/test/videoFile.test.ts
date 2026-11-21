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
  programSetting,
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
      attempts: [
        { route: 'yt-dlp', message: 'yt-dlp failed' },
        { route: 'built-in', message: 'built-in failed' },
      ],
    });
    expect(await downloadVideoFile({ fetchers: [], now: () => NOW }, VIDEO, root)).toEqual({
      ok: false,
      kind: 'unreadable',
      message: 'Jgtube has no way to fetch a video file on this computer.',
      via: null,
      attempts: [],
    });
  });

  test('tries the next way after YouTube refused the first, and keeps the refusal as the answer', async () => {
    const refused = fakeFetcher('yt-dlp', {
      ok: false,
      kind: 'refused',
      message: 'YouTube refused this computer’s connection for now.',
      via: 'yt-dlp',
    });
    const alsoFailed = fakeFetcher('built-in', {
      ok: false,
      kind: 'unreadable',
      message: 'installing yt-dlp is the fix',
      via: 'built-in',
    });

    const result = await downloadVideoFile(
      { fetchers: [refused, alsoFailed], now: () => NOW },
      VIDEO,
      root,
    );

    expect(alsoFailed.calls).toEqual([VIDEO]);
    expect(result).toMatchObject({ ok: false, kind: 'refused', via: 'yt-dlp' });
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

  test('uses the full path the owner named in the setting, ahead of the PATH', async () => {
    const elsewhere = join(bin('yt-dlp.exe', 0o644), 'yt-dlp.exe');
    const onPath = bin('yt-dlp.exe', 0o644);

    expect(programSetting('yt-dlp')).toBe('JGTUBE_YT_DLP_PATH');
    expect(programSetting('ffmpeg')).toBe('JGTUBE_FFMPEG_PATH');
    expect(
      await findProgram('yt-dlp', { Path: onPath, jgtube_yt_dlp_path: elsewhere }, 'win32'),
    ).toBe(elsewhere);
    expect(
      await findProgram(
        'yt-dlp',
        { Path: onPath, JGTUBE_YT_DLP_PATH: join(root, 'gone.exe') },
        'win32',
      ),
    ).toBe(join(onPath, 'yt-dlp.exe'));
    expect(await findProgram('yt-dlp', { JGTUBE_YT_DLP_PATH: 'yt-dlp.exe' }, 'win32')).toBeNull();
  });

  test('on Windows, looks where winget, scoop, Chocolatey and Python put programs', async () => {
    const place = (...parts: string[]): string => {
      const folder = join(root, ...parts);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'yt-dlp.exe'), '');
      return join(folder, 'yt-dlp.exe');
    };
    const local = join(root, 'local');
    const winget = place('local', 'Microsoft', 'WinGet', 'Links');
    const pip = place('roaming', 'Python', 'Python312', 'Scripts');
    const scoop = place('home', 'scoop', 'shims');
    const choco = place('all', 'chocolatey', 'bin');

    expect(await findProgram('yt-dlp', { LOCALAPPDATA: local }, 'win32')).toBe(winget);
    expect(await findProgram('yt-dlp', { AppData: join(root, 'roaming') }, 'win32')).toBe(pip);
    expect(await findProgram('yt-dlp', { USERPROFILE: join(root, 'home') }, 'win32')).toBe(scoop);
    expect(await findProgram('yt-dlp', { ALLUSERSPROFILE: join(root, 'all') }, 'win32')).toBe(
      choco,
    );
    const store = place(
      'store',
      'Packages',
      'PythonSoftwareFoundation.Python.3.13_abc',
      'LocalCache',
      'local-packages',
      'Python313',
      'Scripts',
    );
    place('store', 'Packages', 'SomeOtherApp_abc', 'LocalCache', 'local-packages', 'X', 'Scripts');
    expect(await findProgram('yt-dlp', { LocalAppData: join(root, 'store') }, 'win32')).toBe(store);
    expect(await findProgram('yt-dlp', { LOCALAPPDATA: local }, 'linux')).toBeNull();
    expect(await findProgram('ffmpeg', { LOCALAPPDATA: local }, 'win32')).toBeNull();
  });

  test('never searches a folder that is not a full path, such as the current one', async () => {
    expect(
      await findProgram('yt-dlp', { PATH: ['.', '', 'bin'].join(delimiter) }, 'linux'),
    ).toBeNull();
  });
});

describe('the yt-dlp route', () => {
  const PROGRAM = '/usr/local/bin/yt-dlp';
  const NODE = '/opt/node/bin/node';
  const ok = (stdout: string): ProgramResult => ({ code: 0, stdout, stderr: '' });
  /** What an older yt-dlp prints when it is handed an option it does not have. */
  const UNKNOWN_OPTION =
    'Usage: yt-dlp [OPTIONS] URL [URL...]\n\nyt-dlp: error: no such option: --js-runtimes\n';

  test('starts yt-dlp with a list of arguments that keeps every file in the folder', () => {
    const args = ytDlpArguments(VIDEO, '/data/downloads/video-temp', 95_000_000, NODE);

    expect(args).toEqual([
      '--js-runtimes',
      `node:${NODE}`,
      '--no-playlist',
      '--no-progress',
      '--no-warnings',
      '--no-part',
      '--no-simulate',
      '--format',
      'best[height<=720][height>=240][vcodec!=none][acodec!=none]',
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

  test('leaves the JavaScript runtime out when it is not told where Node is', () => {
    expect(ytDlpArguments(VIDEO, '/data/video-temp', 1)).not.toContain('--js-runtimes');
  });

  test('names Node as one argument, even when its path has a drive letter and spaces', () => {
    const windowsNode = 'C:\\Program Files\\nodejs\\node.exe';

    const args = ytDlpArguments(VIDEO, 'C:\\jgtube\\video-temp', 1, windowsNode);

    expect(args[args.indexOf('--js-runtimes') + 1]).toBe(`node:${windowsNode}`);
  });

  test('a video id that begins with a dash is never where yt-dlp reads an option', () => {
    const dashed = '-aaaaaaaaaa';

    const args = ytDlpArguments(dashed, '/data/video-temp', 1, NODE);

    const separator = args.indexOf('--');
    const holding = args.flatMap((arg, index) => (arg.includes(dashed) ? [index] : []));
    // Once as the value of --output, and once inside the full link after "--".
    expect(holding).toEqual([args.indexOf('--output') + 1, separator + 1]);
    expect(args.at(-1)).toBe(`https://www.youtube.com/watch?v=${dashed}`);
    expect(separator).toBe(args.length - 2);
    expect(args.filter((arg) => arg.startsWith('-') && arg.includes(dashed))).toEqual([
      `${dashed}.%(ext)s`,
    ]);
  });

  test('downloads a video whose id begins with a dash like any other', async () => {
    const dashed = '-aaaaaaaaaa';
    const folder = tempFolder();
    const fetcher = ytDlpFetcher(PROGRAM, async () => {
      writeFileSync(join(folder, `${dashed}.mp4`), 'video');
      return ok('60|360|mp4|18');
    });

    expect(await fetcher.fetch(dashed, folder, MAX_VIDEO_BYTES)).toMatchObject({
      ok: true,
      path: join(folder, `${dashed}.mp4`),
    });
  });

  test('tells yt-dlp to use the Node that Jgtube itself runs on', async () => {
    const folder = tempFolder();
    const started: Array<readonly string[]> = [];
    const fetcher = ytDlpFetcher(PROGRAM, async (_program, args) => {
      started.push(args);
      writeFileSync(join(folder, `${VIDEO}.mp4`), 'video');
      return ok('948|360|mp4|18');
    });

    await fetcher.fetch(VIDEO, folder, MAX_VIDEO_BYTES);

    expect(started).toHaveLength(1);
    expect(started[0]?.slice(0, 2)).toEqual(['--js-runtimes', `node:${process.execPath}`]);
  });

  test('tries once more without the runtime option when an older yt-dlp does not know it', async () => {
    const folder = tempFolder();
    const started: Array<readonly string[]> = [];
    const fetcher = ytDlpFetcher(
      PROGRAM,
      async (_program, args) => {
        started.push(args);
        if (args.includes('--js-runtimes')) return { code: 2, stdout: '', stderr: UNKNOWN_OPTION };
        writeFileSync(join(folder, `${VIDEO}.mp4`), 'video');
        return ok('948|360|mp4|18');
      },
      { nodePath: NODE },
    );

    const result = await fetcher.fetch(VIDEO, folder, MAX_VIDEO_BYTES);

    expect(result).toMatchObject({ ok: true, via: 'yt-dlp', bytes: 5 });
    expect(started).toHaveLength(2);
    expect(started[1]).toEqual(ytDlpArguments(VIDEO, folder, MAX_VIDEO_BYTES));
  });

  test('does not try a third time when the older yt-dlp fails for another reason', async () => {
    let starts = 0;
    const fetcher = ytDlpFetcher(
      PROGRAM,
      async (_program, args) => {
        starts += 1;
        return args.includes('--js-runtimes')
          ? { code: 2, stdout: '', stderr: UNKNOWN_OPTION }
          : { code: 1, stdout: '', stderr: 'ERROR: unable to open the network' };
      },
      { nodePath: NODE },
    );

    const result = await fetcher.fetch(VIDEO, tempFolder(), MAX_VIDEO_BYTES);

    expect(result).toMatchObject({ ok: false, kind: 'unreadable' });
    expect(starts).toBe(2);
  });

  test.each([
    'ERROR: [youtube] wE5ETbiq1qQ: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ',
    "ERROR: [youtube] wE5ETbiq1qQ: Sign in to confirm you're not a bot. This helps protect our community.",
    'ERROR: unable to download video data: HTTP Error 429: Too Many Requests',
    'ERROR: unable to download video data: HTTP Error 403: Forbidden',
  ])('says in plain words that YouTube refused this computer, for "%s"', async (stderr) => {
    const fetcher = ytDlpFetcher(PROGRAM, async () => ({ code: 1, stdout: '', stderr }));

    const result = await fetcher.fetch(VIDEO, tempFolder(), MAX_VIDEO_BYTES);

    expect(result).toEqual({
      ok: false,
      kind: 'refused',
      message:
        'YouTube refused this computer’s connection for now, as it sometimes does when it suspects a program rather than a person. Try again in a few hours, or from another internet connection.',
      via: 'yt-dlp',
    });
  });

  test('stops yt-dlp when Jgtube is closing, and leaves no file behind', async () => {
    const folder = tempFolder();
    const closing = new AbortController();
    const signals: Array<AbortSignal | undefined> = [];
    const fetcher = ytDlpFetcher(
      PROGRAM,
      async (_program, _args, signal) => {
        signals.push(signal);
        writeFileSync(join(folder, `${VIDEO}.mp4`), 'half a file');
        closing.abort();
        return { code: null, stdout: '', stderr: '' };
      },
      { nodePath: NODE, signal: closing.signal },
    );

    const result = await fetcher.fetch(VIDEO, folder, MAX_VIDEO_BYTES);

    expect(signals).toEqual([closing.signal]);
    expect(result).toMatchObject({
      ok: false,
      kind: 'unreadable',
      message: 'The download was stopped because Jgtube is closing.',
    });
    expect(readdirSync(folder)).toEqual([]);
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
    ['ERROR: unable to download video data: HTTP Error 403: Forbidden', 'refused'],
    ['ERROR: unable to extract the player response; please report this', 'unreadable'],
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

  test('says in plain words that YouTube refused the file, and leaves nothing behind', async () => {
    const failing = player({
      download: async () => {
        throw new Error('The server responded with a non 2xx status code\n  at fetch');
      },
    });

    const result = await fetchWith(failing);

    expect(result).toEqual({
      ok: false,
      kind: 'refused',
      message: 'YouTube refused to send the video file to the download built into Jgtube.',
      via: 'built-in',
    });
    expect(readdirSync(join(root, 'video-temp'))).toEqual([]);
  });

  test('gives the reason for any other failed request, without its stack', async () => {
    const failing = player({
      download: async () => {
        throw new Error('The connection was reset\n  at fetch');
      },
    });

    expect(await fetchWith(failing)).toMatchObject({
      kind: 'unreadable',
      message: 'The file could not be fetched: The connection was reset.',
    });
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

  test('hands yt-dlp the signal that says Jgtube is closing', async () => {
    const bin = mkdtempSync(join(root, 'bin-'));
    writeFileSync(join(bin, 'yt-dlp'), '');
    chmodSync(join(bin, 'yt-dlp'), 0o755);
    const closing = new AbortController();
    const signals: Array<AbortSignal | undefined> = [];

    const result = await downloadVideo(VIDEO, {
      root,
      now: () => NOW,
      env: { PATH: bin },
      platform: 'linux',
      signal: closing.signal,
      run: async (_program, _args, signal) => {
        signals.push(signal);
        closing.abort();
        return { code: null, stdout: '', stderr: '' };
      },
    });

    expect(signals).toEqual([closing.signal]);
    expect(result).toMatchObject({ ok: false, kind: 'unreadable' });
  });

  test('says there is no way to fetch a file when neither route is there', async () => {
    expect(await downloadVideo(VIDEO, { root, env: {} })).toMatchObject({ ok: false, via: null });
    await expect(downloadVideo('not a video', { root, env: {} })).rejects.toThrow(
      /Not a valid YouTube video id or link/,
    );
  });
});

describe('what a failed download tells the owner', () => {
  const refusing = {
    fetchPlayer: async () =>
      player({
        download: async () => {
          throw new Error('The server responded with a non 2xx status code');
        },
      }),
  };

  test('says yt-dlp was not found, and how to point Jgtube at it, when only the built-in way ran', async () => {
    const result = await downloadVideo(VIDEO, {
      root,
      now: () => NOW,
      env: { PATH: '' },
      platform: 'linux',
      source: refusing,
    });

    expect(result).toMatchObject({ ok: false, kind: 'refused' });
    expect(result.ok ? '' : result.message).toMatch(/did not find yt-dlp on this computer/);
    expect(result.ok ? '' : result.message).toMatch(/JGTUBE_YT_DLP_PATH=/);
    expect(result.ok ? '' : result.message).toMatch(/give Jgtube the video file yourself/);
  });

  test('says what yt-dlp itself answered when it was found and failed', async () => {
    const bin = mkdtempSync(join(root, 'bin-'));
    writeFileSync(join(bin, 'yt-dlp'), '');
    chmodSync(join(bin, 'yt-dlp'), 0o755);

    const result = await downloadVideo(VIDEO, {
      root,
      now: () => NOW,
      env: { PATH: bin },
      platform: 'linux',
      run: async () => ({ code: 1, stdout: '', stderr: 'ERROR: unable to open the cookie jar' }),
      source: refusing,
    });

    const message = result.ok ? '' : result.message;
    expect(message).toContain(`yt-dlp (${join(bin, 'yt-dlp')}) was tried first.`);
    expect(message).toMatch(/unable to open the cookie jar/);
    expect(message).toMatch(/Then Jgtube's own download was tried/);
    expect(message).not.toMatch(/did not find yt-dlp/);
  });
});

describe('a video YouTube offers only as picture and sound apart', () => {
  const formatOf = (args: readonly string[]): string => args[args.indexOf('--format') + 1] ?? '';

  test('is asked for as one file only, when there is no ffmpeg to join the two', () => {
    const args = ytDlpArguments(VIDEO, '/tmp/x', 95_000_000, null);

    expect(formatOf(args)).not.toContain('+');
    expect(args).not.toContain('--ffmpeg-location');
    expect(args).not.toContain('--merge-output-format');
  });

  test('is also asked for as the two joined into an MP4, when ffmpeg is on the computer', () => {
    const ffmpeg = 'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe';
    const args = ytDlpArguments(VIDEO, '/tmp/x', 95_000_000, null, ffmpeg);
    const choices = formatOf(args).split('/');

    expect(choices).toEqual([
      'bestvideo[height<=720][height>=240][vcodec^=avc1]+bestaudio[acodec^=mp4a]',
      'bestvideo[height<=720][height>=240]+bestaudio',
      'best[height<=720][height>=240][vcodec!=none][acodec!=none]',
    ]);
    expect(args[args.indexOf('--ffmpeg-location') + 1]).toBe(ffmpeg);
    expect(args[args.indexOf('--merge-output-format') + 1]).toBe('mp4');
    // The link still comes last, after the marker that ends the options.
    expect(args.at(-2)).toBe('--');
  });

  test('says ffmpeg is what is missing when yt-dlp finds no single file and there is none', async () => {
    const noFormat = async () => ({
      code: 1,
      stdout: '',
      stderr: 'ERROR: [youtube] x: Requested format is not available. Use --list-formats',
    });

    const without = await ytDlpFetcher('/bin/yt-dlp', noFormat, { nodePath: null }).fetch(
      VIDEO,
      videoTempFolder(root),
      95_000_000,
    );
    const withIt = await ytDlpFetcher('/bin/yt-dlp', noFormat, {
      nodePath: null,
      ffmpegPath: '/usr/bin/ffmpeg',
    }).fetch(VIDEO, videoTempFolder(root), 95_000_000);

    expect(without).toMatchObject({ ok: false, kind: 'not-available' });
    expect(without.ok ? '' : without.message).toMatch(/needs ffmpeg/);
    expect(withIt.ok ? '' : withIt.message).not.toMatch(/ffmpeg/);
  });

  test('hands yt-dlp the ffmpeg Jgtube found', async () => {
    const bin = mkdtempSync(join(root, 'bin-'));
    for (const name of ['yt-dlp', 'ffmpeg']) {
      writeFileSync(join(bin, name), '');
      chmodSync(join(bin, name), 0o755);
    }
    let seen: readonly string[] = [];

    await downloadVideo(VIDEO, {
      root,
      now: () => NOW,
      env: { PATH: bin },
      platform: 'linux',
      run: async (_program, args) => {
        seen = args;
        return { code: 1, stdout: '', stderr: 'ERROR: nope' };
      },
    });

    expect(seen[seen.indexOf('--ffmpeg-location') + 1]).toBe(join(bin, 'ffmpeg'));
  });
});

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { durationFrom } from '../src/downloads/frameSheets';
import { findProgram, type ProgramResult } from '../src/downloads/program';
import {
  SHRINK_AUDIO_BITS,
  SHRINK_HEIGHT,
  SHRINK_MIN_VIDEO_BITS,
  shrinkArguments,
  shrinkForWatching,
  shrinkPlan,
  type ShrinkOptions,
} from '../src/downloads/shrinkVideo';

const VIDEO = 'wE5ETbiq1qQ';
const MAX = 95_000_000;

let root: string;
let own: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-shrink-'));
  own = join(root, 'my-videos');
  mkdirSync(own, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function withFfmpeg(): Record<string, string> {
  const bin = mkdtempSync(join(root, 'bin-'));
  writeFileSync(join(bin, 'ffmpeg'), '', { mode: 0o755 });
  return { PATH: bin };
}

const said = (duration: string, code = 0): ProgramResult => ({
  code,
  stdout: '',
  stderr: `  Duration: ${duration}, start: 0.000000, bitrate: 4000 kb/s\n`,
});

const original = (): string => {
  const path = join(own, `${VIDEO}.mp4`);
  writeFileSync(path, 'the owner’s full-quality copy');
  return path;
};

/** Options whose ffmpeg is a stand-in: the first start reads the length, the second writes `bytes`. */
function standIn(bytes: number, more: Partial<ShrinkOptions> = {}) {
  const started: Array<readonly string[]> = [];
  const options: ShrinkOptions = {
    root,
    maxBytes: MAX,
    env: withFfmpeg(),
    platform: 'linux',
    alsoFrom: [own],
    run: async (_program, args) => {
      started.push(args);
      if (started.length === 1) return said('00:30:00.00', 1);
      writeFileSync(args.at(-1) ?? '', Buffer.alloc(bytes));
      return said('00:30:00.00');
    },
    ...more,
  };
  return { started, options };
}

describe('shrinkPlan', () => {
  test('keeps the numbers it works by named', () => {
    expect([SHRINK_HEIGHT, SHRINK_AUDIO_BITS, SHRINK_MIN_VIDEO_BITS]).toEqual([
      360, 64_000, 100_000,
    ]);
  });

  test('spends nine tenths of the size limit over the video’s length, less the sound', () => {
    // 95 MB over half an hour is 422 kbit a second; nine tenths of it, less 64 for sound.
    expect(shrinkPlan(1800, MAX)).toEqual({ videoBitsPerSecond: 316_000 });
  });

  test('never asks for a sharper picture than a 360p file needs', () => {
    expect(shrinkPlan(60, MAX)).toEqual({ videoBitsPerSecond: 700_000 });
  });

  test('has no plan for a video so long that the picture would be unwatchable', () => {
    expect(shrinkPlan(6 * 3600, MAX)).toBeNull();
    expect(shrinkPlan(0, MAX)).toBeNull();
  });
});

describe('shrinkArguments', () => {
  test('is a list that reads one file and writes one smaller MP4', () => {
    expect(shrinkArguments('/in/a.mp4', '/out/a.small.mp4', 316_000)).toEqual([
      '-hide_banner',
      '-nostdin',
      '-nostats',
      '-y',
      '-i',
      '/in/a.mp4',
      '-vf',
      "scale=-2:'min(360,ih)'",
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-b:v',
      '316000',
      '-maxrate',
      '316000',
      '-bufsize',
      '632000',
      '-c:a',
      'aac',
      '-b:a',
      '64000',
      '-movflags',
      '+faststart',
      '/out/a.small.mp4',
    ]);
  });

  test('refuses a path that is not absolute, so none can pass for an option', () => {
    expect(() => shrinkArguments('-a.mp4', '/out/a.mp4', 1)).toThrow(/absolute/);
    expect(() => shrinkArguments('/in/a.mp4', '-out.mp4', 1)).toThrow(/absolute/);
  });
});

describe('shrinkForWatching with a stand-in ffmpeg', () => {
  test('writes a smaller copy into the temporary folder and leaves the original alone', async () => {
    const path = original();
    const { started, options } = standIn(80_000_000);

    const result = await shrinkForWatching({ videoId: VIDEO, path }, options);

    const copy = join(root, 'video-temp', `${VIDEO}.small.mp4`);
    expect(result).toEqual({ ok: true, path: copy, bytes: 80_000_000 });
    expect(started).toHaveLength(2);
    expect(started[0]).toEqual(['-hide_banner', '-nostdin', '-i', path]);
    expect(started[1]?.[started[1].indexOf('-b:v') + 1]).toBe('316000');
    expect(existsSync(path)).toBe(true);
  });

  test.each([
    ['ffmpeg is not installed on this computer', { env: { PATH: '' } }],
    ['ffmpeg could not tell how long the video is', { run: async () => said('N/A', 1) }],
  ] as const)('says "%s" and writes nothing', async (reason, more) => {
    const { options } = standIn(1, more as Partial<ShrinkOptions>);

    const result = await shrinkForWatching({ videoId: VIDEO, path: original() }, options);

    expect(result).toEqual({ ok: false, reason });
    expect(existsSync(join(root, 'video-temp', `${VIDEO}.small.mp4`))).toBe(false);
  });

  test('says the video is too long to shrink, without starting the encode', async () => {
    const { started, options } = standIn(1);
    const run: ShrinkOptions['run'] = async (_program, args) => {
      started.push(args);
      return said('06:00:00.00', 1);
    };

    const result = await shrinkForWatching(
      { videoId: VIDEO, path: original() },
      { ...options, run },
    );

    expect(result).toEqual({
      ok: false,
      reason: 'the video is too long to make a watchable copy that small',
    });
    expect(started).toHaveLength(1);
  });

  test('removes a copy that still came out too large, or that ffmpeg failed on', async () => {
    const tooBig = standIn(MAX + 1);
    const failing = standIn(10);
    const run: ShrinkOptions['run'] = async (_program, args) => {
      if (!args.includes('-b:v')) return said('00:30:00.00', 1);
      writeFileSync(args.at(-1) ?? '', 'half');
      return { code: 1, stdout: '', stderr: 'Conversion failed' };
    };
    const video = { videoId: VIDEO, path: original() };

    expect(await shrinkForWatching(video, tooBig.options)).toEqual({
      ok: false,
      reason: 'the smaller copy still came out over the size limit',
    });
    expect(await shrinkForWatching(video, { ...failing.options, run })).toEqual({
      ok: false,
      reason: 'ffmpeg could not make the smaller copy',
    });
    expect(existsSync(join(root, 'video-temp', `${VIDEO}.small.mp4`))).toBe(false);
  });

  test('stops when Jgtube is closing, and leaves no copy behind', async () => {
    const closing = new AbortController();
    const { options } = standIn(10, { signal: closing.signal });
    const run: ShrinkOptions['run'] = async (_program, args) => {
      if (!args.includes('-b:v')) return said('00:30:00.00', 1);
      writeFileSync(args.at(-1) ?? '', 'half');
      closing.abort();
      return { code: null, stdout: '', stderr: '' };
    };

    const result = await shrinkForWatching(
      { videoId: VIDEO, path: original() },
      { ...options, run },
    );

    expect(result).toEqual({ ok: false, reason: 'it was stopped because Jgtube is closing' });
    expect(existsSync(join(root, 'video-temp', `${VIDEO}.small.mp4`))).toBe(false);
  });

  test('only ever reads a file from the folders it is told about', async () => {
    const { options } = standIn(10);
    const outside = join(root, 'elsewhere.mp4');
    writeFileSync(outside, 'x');

    await expect(shrinkForWatching({ videoId: VIDEO, path: outside }, options)).rejects.toThrow(
      /outside/,
    );
  });
});

describe('shrinkForWatching with the real ffmpeg', async () => {
  const ffmpeg = await findProgram('ffmpeg');

  test.skipIf(ffmpeg === null)(
    'makes a whole, smaller MP4 of the same length that fits the limit',
    async () => {
      const path = join(own, `${VIDEO}.mp4`);
      // A deliberately heavy clip: noise does not compress, so it comes out large.
      execFileSync(ffmpeg ?? '', [
        ...['-hide_banner', '-loglevel', 'error', '-y'],
        ...['-f', 'lavfi', '-i', 'testsrc2=duration=20:size=1280x720:rate=30'],
        ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=20'],
        ...['-vf', 'noise=alls=40:allf=t', '-c:v', 'libx264', '-b:v', '4000k'],
        ...['-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path],
      ]);
      const before = statSync(path).size;
      const limit = 1_500_000;
      expect(before).toBeGreaterThan(limit * 2);

      const result = await shrinkForWatching(
        { videoId: VIDEO, path },
        { root, maxBytes: limit, alsoFrom: [own] },
      );

      expect(result).toMatchObject({ ok: true });
      const copy = result.ok ? result.path : '';
      expect(statSync(copy).size).toBeLessThanOrEqual(limit);
      expect(statSync(path).size).toBe(before);
      // ffmpeg reads the copy back as a 360-line video of the same length.
      let probe = '';
      try {
        execFileSync(ffmpeg ?? '', ['-hide_banner', '-nostdin', '-i', copy], { stdio: 'pipe' });
      } catch (error) {
        probe = String((error as { stderr?: Buffer }).stderr ?? '');
      }
      expect(Math.round(durationFrom(probe) ?? 0)).toBe(20);
      expect(probe).toMatch(/640x360/);
    },
    120_000,
  );
});

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  FRAME_EVERY_SECONDS,
  MAX_FRAME_SHEETS,
  SHEET_COLUMNS,
  SHEET_FRAME_HEIGHT,
  SHEET_FRAME_WIDTH,
  SHEET_ROWS,
  cutFrameSheets,
  ffmpegArguments,
  frameSheetFolder,
  readFileFrames,
  removeFrameSheets,
  type CutOptions,
} from '../src/downloads/frameSheets';
import { findProgram, type ProgramResult } from '../src/downloads/program';

const NOW = new Date('2026-11-20T12:00:00Z');
const VIDEO = 'wE5ETbiq1qQ';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

let root: string;
let temp: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-sheets-'));
  temp = join(root, 'video-temp');
  mkdirSync(temp, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A place where "ffmpeg" is found, without it being a real program. */
function withFfmpeg(): Record<string, string> {
  const bin = mkdtempSync(join(root, 'bin-'));
  writeFileSync(join(bin, 'ffmpeg'), '', { mode: 0o755 });
  return { PATH: bin };
}

const ran = (seconds: string): ProgramResult => ({
  code: 0,
  stdout: '',
  stderr: `Input #0, mov,mp4, from 'x':\n  Duration: ${seconds}, start: 0.000000, bitrate: 126 kb/s\n`,
});

/** Options for a cut whose ffmpeg is a stand-in that writes `sheets` small pictures. */
function standIn(sheets: number, result: ProgramResult, more: Partial<CutOptions> = {}) {
  const started: Array<[string, readonly string[]]> = [];
  const options: CutOptions = {
    root,
    now: () => NOW,
    env: withFfmpeg(),
    platform: 'linux',
    run: async (program, args) => {
      started.push([program, args]);
      const folder = frameSheetFolder(root, VIDEO);
      for (let n = 1; n <= sheets; n += 1) {
        writeFileSync(join(folder, `sheet-${String(n).padStart(3, '0')}.jpg`), JPEG);
      }
      return result;
    },
    ...more,
  };
  return { started, options };
}

const clip = (videoId = VIDEO): string => {
  const path = join(temp, `${videoId}.mp4`);
  writeFileSync(path, 'stand-in video');
  return path;
};

describe('the numbers frames are cut by', () => {
  test('are one frame a second, twenty-five to a sheet, small enough to be looked at whole', () => {
    expect([FRAME_EVERY_SECONDS, SHEET_COLUMNS, SHEET_ROWS]).toEqual([1, 5, 5]);
    expect([SHEET_FRAME_WIDTH, SHEET_FRAME_HEIGHT]).toEqual([288, 162]);
    // The longest sheet edge stays under what a model is shown without shrinking.
    expect(SHEET_COLUMNS * SHEET_FRAME_WIDTH).toBeLessThanOrEqual(1568);
    expect(MAX_FRAME_SHEETS).toBe(80);
  });
});

describe('ffmpegArguments', () => {
  test('is a list that reads one file and writes numbered sheets into one folder', () => {
    const args = ffmpegArguments('/data/video-temp/abc.mp4', '/data/video-temp/frames-abc');

    expect(args).toEqual([
      '-hide_banner',
      '-nostdin',
      '-nostats',
      '-y',
      '-i',
      '/data/video-temp/abc.mp4',
      '-an',
      '-sn',
      '-vf',
      'fps=1,scale=288:162:force_original_aspect_ratio=decrease,pad=288:162:(ow-iw)/2:(oh-ih)/2,tile=5x5',
      '-frames:v',
      '80',
      '-q:v',
      '5',
      join('/data/video-temp/frames-abc', 'sheet-%03d.jpg'),
    ]);
  });

  test('refuses a path that is not absolute, so none can pass for an option', () => {
    expect(() => ffmpegArguments('-aaaaaaaaaa.mp4', '/data/frames')).toThrow(/absolute/);
    expect(() => ffmpegArguments('/data/a.mp4', '-frames')).toThrow(/absolute/);
  });
});

describe('cutFrameSheets with a stand-in ffmpeg', () => {
  test('says where the sheets are, how many, and what each one shows', async () => {
    const { started, options } = standIn(3, ran('00:01:02.00'));

    const cut = await cutFrameSheets({ videoId: VIDEO, path: clip() }, options);

    const folder = join(temp, `frames-${VIDEO}`);
    expect(cut).toEqual({ ok: true, folder, sheetCount: 3, frameCount: 62 });
    expect(started[0]?.[0]).toBe(join(options.env?.['PATH'] ?? '', 'ffmpeg'));
    expect(started[0]?.[1][5]).toBe(join(temp, `${VIDEO}.mp4`));
    expect(JSON.parse(readFileSync(join(folder, 'index.json'), 'utf8'))).toEqual({
      videoId: VIDEO,
      cutAt: '2026-11-20T12:00:00.000Z',
      everySeconds: 1,
      columns: 5,
      rows: 5,
      frameWidth: 288,
      frameHeight: 162,
      frameCount: 62,
      sheets: [
        { index: 0, file: 'sheet-001.jpg', frames: 25, firstSecond: 0, lastSecond: 24 },
        { index: 1, file: 'sheet-002.jpg', frames: 25, firstSecond: 25, lastSecond: 49 },
        { index: 2, file: 'sheet-003.jpg', frames: 12, firstSecond: 50, lastSecond: 61 },
      ],
    });
  });

  test('cuts a video whose id begins with a dash like any other', async () => {
    const dashed = '-aaaaaaaaaa';
    const started: Array<readonly string[]> = [];
    const options: CutOptions = {
      root,
      now: () => NOW,
      env: withFfmpeg(),
      platform: 'linux',
      run: async (_program, args) => {
        started.push(args);
        writeFileSync(join(frameSheetFolder(root, dashed), 'sheet-001.jpg'), JPEG);
        return ran('00:00:10.00');
      },
    };

    const cut = await cutFrameSheets({ videoId: dashed, path: clip(dashed) }, options);

    expect(cut).toMatchObject({ ok: true, sheetCount: 1, frameCount: 10 });
    // Every argument that names the video is a whole path from the root of the disk.
    const naming = (started[0] ?? []).filter((arg) => arg.includes(dashed));
    expect(naming).toHaveLength(2);
    expect(naming.every((arg) => arg.startsWith(root))).toBe(true);
  });

  test('says ffmpeg is not installed, and starts nothing, when it is not found', async () => {
    const { started, options } = standIn(1, ran('00:00:10.00'), { env: { PATH: '' } });

    const cut = await cutFrameSheets({ videoId: VIDEO, path: clip() }, options);

    expect(cut).toEqual({ ok: false, reason: 'ffmpeg is not installed on this computer' });
    expect(started).toEqual([]);
    expect(existsSync(frameSheetFolder(root, VIDEO))).toBe(false);
  });

  test.each([
    ['ffmpeg ended with an error', 0, { code: 1, stdout: '', stderr: 'Invalid data found' }],
    ['ffmpeg took too long and was stopped', 0, { code: null, stdout: '', stderr: '' }],
    ['ffmpeg wrote no frames', 0, ran('00:00:10.00')],
  ])('says "%s" and leaves no folder behind', async (reason, sheets, result) => {
    const { options } = standIn(sheets, result);

    const cut = await cutFrameSheets({ videoId: VIDEO, path: clip() }, options);

    expect(cut).toEqual({ ok: false, reason });
    expect(existsSync(frameSheetFolder(root, VIDEO))).toBe(false);
  });

  test('refuses what ffmpeg wrote when it is not a picture, and removes it', async () => {
    const { options } = standIn(0, ran('00:00:10.00'));
    const run: CutOptions['run'] = async () => {
      writeFileSync(join(frameSheetFolder(root, VIDEO), 'sheet-001.jpg'), 'not a picture');
      return ran('00:00:10.00');
    };

    const cut = await cutFrameSheets({ videoId: VIDEO, path: clip() }, { ...options, run });

    expect(cut).toEqual({ ok: false, reason: 'ffmpeg wrote a sheet that is not a JPEG picture' });
    expect(existsSync(frameSheetFolder(root, VIDEO))).toBe(false);
  });

  test('stops ffmpeg when Jgtube is closing, and leaves no folder behind', async () => {
    const closing = new AbortController();
    const signals: Array<AbortSignal | undefined> = [];
    const { options } = standIn(0, ran('00:00:10.00'), { signal: closing.signal });
    const run: CutOptions['run'] = async (_program, _args, signal) => {
      signals.push(signal);
      closing.abort();
      return { code: null, stdout: '', stderr: '' };
    };

    const cut = await cutFrameSheets({ videoId: VIDEO, path: clip() }, { ...options, run });

    expect(signals).toEqual([closing.signal]);
    expect(cut).toEqual({ ok: false, reason: 'the cutting was stopped because Jgtube is closing' });
    expect(existsSync(frameSheetFolder(root, VIDEO))).toBe(false);
  });

  test('only ever cuts a file from the temporary folder, and only for a video id', async () => {
    const { started, options } = standIn(1, ran('00:00:10.00'));
    const outside = join(root, 'elsewhere.mp4');
    writeFileSync(outside, 'x');

    await expect(cutFrameSheets({ videoId: VIDEO, path: outside }, options)).rejects.toThrow(
      /outside/,
    );
    await expect(cutFrameSheets({ videoId: '../../x', path: clip() }, options)).rejects.toThrow(
      /video id/,
    );
    expect(started).toEqual([]);
  });

  test('clears sheets left by an earlier cut before cutting again', async () => {
    const first = standIn(3, ran('00:01:02.00'));
    await cutFrameSheets({ videoId: VIDEO, path: clip() }, first.options);
    const second = standIn(1, ran('00:00:10.00'));

    const cut = await cutFrameSheets({ videoId: VIDEO, path: clip() }, second.options);

    expect(cut).toMatchObject({ ok: true, sheetCount: 1 });
    expect(readdirSync(frameSheetFolder(root, VIDEO)).sort()).toEqual([
      'index.json',
      'sheet-001.jpg',
    ]);
  });
});

describe('readFileFrames', () => {
  const cutThree = async (): Promise<void> => {
    await cutFrameSheets({ videoId: VIDEO, path: clip() }, standIn(3, ran('00:01:02.00')).options);
  };

  test('has nothing for a video whose file was never cut', async () => {
    expect(await readFileFrames(root, VIDEO, 4)).toBeNull();
  });

  test('serves sheets in a row from the one asked for, each with its caption', async () => {
    await cutThree();

    const frames = await readFileFrames(root, VIDEO, 2, 1);

    expect(frames).toMatchObject({
      videoId: VIDEO,
      source: 'file',
      sheetCount: 3,
      frameCount: 62,
      frameWidth: 288,
      frameHeight: 162,
    });
    expect(frames?.sheets.map((entry) => entry.sheet.index)).toEqual([1, 2]);
    expect(frames?.sheets[1]?.caption).toBe(
      'Sheet 3 of 3: a grid 5 across and 5 down, in order left to right, then top to bottom. 12 frames (the last 13 places of the grid are empty), one every 1 second, from 0:50 to 1:01.',
    );
    expect(frames?.sheets[0]?.image).toEqual({
      ok: true,
      bytes: new Uint8Array(JPEG),
      mimeType: 'image/jpeg',
    });
  });

  test('spreads the sheets across the video when no starting sheet is given', async () => {
    await cutThree();

    const frames = await readFileFrames(root, VIDEO, 2);

    expect(frames?.sheets.map((entry) => entry.sheet.index)).toEqual([0, 2]);
  });

  test('gives no sheets, and still the totals, when asked to start past the end', async () => {
    await cutThree();

    expect(await readFileFrames(root, VIDEO, 4, 7)).toMatchObject({ sheetCount: 3, sheets: [] });
  });

  test('says so when a sheet has gone missing or is no longer a picture', async () => {
    await cutThree();
    const folder = frameSheetFolder(root, VIDEO);
    rmSync(join(folder, 'sheet-001.jpg'));
    writeFileSync(join(folder, 'sheet-002.jpg'), 'swapped for text');

    const frames = await readFileFrames(root, VIDEO, 3, 0);

    expect(frames?.sheets.map((entry) => entry.image.ok)).toEqual([false, false, true]);
    expect(frames?.sheets[0]?.image).toEqual({ ok: false, reason: 'the sheet is no longer there' });
  });

  test('never reads a file the index names outside the folder', async () => {
    await cutThree();
    const folder = frameSheetFolder(root, VIDEO);
    const index = JSON.parse(readFileSync(join(folder, 'index.json'), 'utf8')) as {
      sheets: Array<{ file: string }>;
    };
    writeFileSync(join(root, 'secret.jpg'), JPEG);
    index.sheets[0] = { ...index.sheets[0], file: '../../secret.jpg' } as { file: string };
    writeFileSync(join(folder, 'index.json'), JSON.stringify(index));

    expect(await readFileFrames(root, VIDEO, 3, 0)).toBeNull();
  });

  test('has nothing once the sheets have been removed, and removing twice is harmless', async () => {
    await cutThree();

    await removeFrameSheets(root, VIDEO);
    await removeFrameSheets(root, VIDEO);

    expect(await readFileFrames(root, VIDEO, 4)).toBeNull();
    expect(existsSync(frameSheetFolder(root, VIDEO))).toBe(false);
  });
});

describe('cutFrameSheets with the real ffmpeg', async () => {
  const ffmpeg = await findProgram('ffmpeg');

  test.skipIf(ffmpeg === null)(
    'cuts a 62-second clip into three sheets of real pictures with the right times',
    async () => {
      const path = join(temp, `${VIDEO}.mp4`);
      // A clip made by ffmpeg's own test picture and a tone: nothing is fetched.
      execFileSync(ffmpeg ?? '', [
        ...['-hide_banner', '-loglevel', 'error', '-y'],
        ...['-f', 'lavfi', '-i', 'testsrc=duration=62:size=640x360:rate=30'],
        ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=62'],
        ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path],
      ]);

      const cut = await cutFrameSheets({ videoId: VIDEO, path }, { root, now: () => NOW });

      expect(cut).toMatchObject({ ok: true, sheetCount: 3, frameCount: 62 });
      const frames = await readFileFrames(root, VIDEO, 6, 0);
      expect(frames?.sheets.map((entry) => entry.sheet)).toEqual([
        expect.objectContaining({ index: 0, frames: 25, firstFrameMs: 0, lastFrameMs: 24_000 }),
        expect.objectContaining({ index: 1, frames: 25, firstFrameMs: 25_000 }),
        expect.objectContaining({ index: 2, frames: 12, lastFrameMs: 61_000 }),
      ]);
      for (const entry of frames?.sheets ?? []) {
        const bytes = entry.image.ok ? entry.image.bytes : new Uint8Array();
        // A JPEG starts FF D8 and ends FF D9.
        expect([bytes[0], bytes[1], bytes.at(-2), bytes.at(-1)]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
        expect(bytes.length).toBeGreaterThan(10_000);
      }
    },
    60_000,
  );
});

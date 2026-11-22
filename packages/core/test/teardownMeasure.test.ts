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
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { findProgram, type ProgramResult } from '../src/downloads/program';
import { measureVideo } from '../src/teardown/measure';
import { measurementsSchema, parseMeasurements } from '../src/teardown/measurements';
import {
  keyframeArgs,
  peakWindowSeconds,
  sceneArgs,
  spanSheetArgs,
} from '../src/teardown/ffmpegArgs';

const NOW = new Date('2026-11-22T10:00:00Z');
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-teardown-'));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A place where ffmpeg and ffprobe are found, without either being a real program. */
function fakeBin(): Record<string, string> {
  const bin = mkdtempSync(join(root, 'bin-'));
  writeFileSync(join(bin, 'ffmpeg'), '', { mode: 0o755 });
  writeFileSync(join(bin, 'ffprobe'), '', { mode: 0o755 });
  return { PATH: bin };
}

const result = (code: number | null, stdout = '', stderr = ''): ProgramResult => ({
  code,
  stdout,
  stderr,
});

describe('argument lists', () => {
  test('only absolute paths, the scene threshold named, windows grow for long videos', () => {
    expect(() => sceneArgs('clip.mp4')).toThrow(/absolute/);
    expect(() => keyframeArgs('/a.mp4', 1, 'k.jpg', '/k.rgb')).toThrow(/absolute/);
    expect(sceneArgs('/a.mp4')).toContain("select='gt(scene,0.3)',showinfo");
    expect(peakWindowSeconds(60)).toBe(0.5);
    expect(peakWindowSeconds(3600)).toBe(1.8);
    const sheet = spanSheetArgs('/a.mp4', { start: 10, end: 30 }, 5, 4, '/s.jpg');
    expect(sheet).toEqual(expect.arrayContaining(['-ss', '10.000', '-t', '20.000']));
    expect(sheet.join(' ')).toContain('fps=1.0000');
  });
});

describe('measureVideo with stand-in programs', () => {
  test('says when ffmpeg or ffprobe is missing, starting nothing', async () => {
    const empty = mkdtempSync(join(root, 'none-'));
    expect(await measureVideo('/a.mp4', join(root, 'out'), { env: { PATH: empty } })).toEqual({
      ok: false,
      reason: 'ffmpeg is not installed on this computer',
    });
    writeFileSync(join(empty, 'ffmpeg'), '', { mode: 0o755 });
    expect(await measureVideo('/a.mp4', join(root, 'out'), { env: { PATH: empty } })).toEqual({
      ok: false,
      reason: 'ffprobe (part of ffmpeg) is not installed on this computer',
    });
  });

  test('fails plainly when the length or the pictures cannot be read', async () => {
    const env = fakeBin();
    const noProbe = await measureVideo('/a.mp4', join(root, 'out'), {
      env,
      run: async () => result(1),
    });
    expect(noProbe).toEqual({ ok: false, reason: 'ffprobe could not read the length of the file' });
    const probe = JSON.stringify({
      streams: [{ codec_type: 'video' }],
      format: { duration: '10' },
    });
    const noScenes = await measureVideo('/a.mp4', join(root, 'out'), {
      env,
      run: async (program) => (program.endsWith('ffprobe') ? result(0, probe) : result(1)),
    });
    expect(noScenes).toEqual({ ok: false, reason: 'ffmpeg could not go through its pictures' });
  });

  test('a silent file with failing frame grabs is measured with its problems named', async () => {
    const env = fakeBin();
    const probe = JSON.stringify({
      streams: [{ codec_type: 'video' }],
      format: { duration: '10' },
    });
    const steps: string[] = [];
    const measured = await measureVideo('/a.mp4', join(root, 'silent'), {
      env,
      stream: async () => 1,
      now: () => NOW,
      onStep: (text) => steps.push(text),
      run: async (program, args) => {
        if (program.endsWith('ffprobe')) return result(0, probe);
        if (args.includes('-vf') && String(args[args.indexOf('-vf') + 1]).startsWith('select')) {
          return result(0, '', 'pts_time:4\npts_time:12');
        }
        return result(1);
      },
    });
    expect(measured.ok).toBe(true);
    if (!measured.ok) return;
    expect(measurementsSchema.parse(measured.measurements)).toBeTruthy();
    expect(measured.measurements.shots).toMatchObject({ cuts: [4], cutCount: 1, shotCount: 2 });
    expect(measured.measurements.loudness).toBeNull();
    expect(measured.measurements.problems).toEqual([
      'It has no sound track.',
      'No keyframe could be taken.',
      'The opening could not be put on a sheet.',
      'Its frames could not be gone through one by one.',
    ]);
    expect(steps[0]).toBe('Reading its length, size and frame rate');
  });

  test('names each sound measurement that failed', async () => {
    const env = fakeBin();
    const probe = JSON.stringify({
      streams: [{ codec_type: 'video' }, { codec_type: 'audio' }],
      format: { duration: '5' },
    });
    const measured = await measureVideo('/a.mp4', join(root, 'loud'), {
      env,
      stream: async () => 1,
      run: async (program, args) => {
        if (program.endsWith('ffprobe')) return result(0, probe);
        return args.includes('-an') && !args.includes('-ss') && !args.includes('-t')
          ? result(0)
          : result(1);
      },
    });
    expect(measured.ok && measured.measurements.problems.slice(0, 3)).toEqual([
      'Its loudness could not be measured.',
      'Its quiet dips could not be measured.',
      'Its peak impacts could not be measured.',
    ]);
  });

  test('stops when Jgtube is closing', async () => {
    const env = fakeBin();
    const stop = new AbortController();
    stop.abort();
    const measured = await measureVideo('/a.mp4', join(root, 'stop'), {
      env,
      signal: stop.signal,
      run: async () => result(0),
    });
    expect(measured).toEqual({
      ok: false,
      reason: 'the measuring was stopped because Jgtube is closing',
    });
  });
});

describe('measureVideo with the real ffmpeg', async () => {
  const ffmpeg = await findProgram('ffmpeg');
  const ffprobe = await findProgram('ffprobe');
  const real = ffmpeg !== null && ffprobe !== null;

  /**
   * A 12-second clip with known cuts and sound: red 0–3 s, blue 3–7 s, white
   * 7–9 s, green 9–12 s; a 1 kHz tone at -20 dBFS, silent from 4 to 6 s, with
   * a burst at -0.9 dBFS from 9 to 9.5 s. Made by ffmpeg; nothing is fetched.
   */
  function makeClip(path: string): void {
    const colour = (name: string, seconds: number): string[] => [
      '-f',
      'lavfi',
      '-i',
      `color=c=${name}:s=320x180:r=25:d=${seconds}`,
    ];
    execFileSync(ffmpeg ?? '', [
      ...['-hide_banner', '-loglevel', 'error', '-y'],
      ...colour('red', 3),
      ...colour('blue', 4),
      ...colour('white', 2),
      ...colour('green', 3),
      ...[
        '-f',
        'lavfi',
        '-i',
        "aevalsrc='if(between(t,4,6),0,if(between(t,9,9.5),0.9,0.1))*sin(2*PI*1000*t)':s=48000:d=12",
      ],
      ...[
        '-filter_complex',
        '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]',
        '-map',
        '[v]',
        '-map',
        '4:a',
      ],
      ...['-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-c:a', 'pcm_s16le', path],
    ]);
  }

  test.skipIf(!real)(
    'measures the cuts, sound, colours and pictures of a generated clip exactly',
    async () => {
      const clip = join(root, 'clip.mkv');
      makeClip(clip);
      const folder = join(root, 'teardown-clip');
      const measured = await measureVideo(clip, folder, { now: () => NOW });
      expect(measured.ok).toBe(true);
      if (!measured.ok) return;
      const m = measured.measurements;
      expect(m.video).toMatchObject({
        durationSeconds: 12,
        width: 320,
        height: 180,
        fps: 25,
        hasAudio: true,
      });
      expect(m.shots).toMatchObject({
        cuts: [3, 7, 9],
        cutCount: 3,
        shotCount: 4,
        medianSeconds: 3,
        averageSeconds: 3,
        cutsPerMinute: 15,
      });
      expect(m.quietDips?.items).toHaveLength(1);
      expect(m.quietDips?.items[0]?.start).toBeCloseTo(4, 1);
      expect(m.quietDips?.items[0]?.end).toBeCloseTo(6, 1);
      expect(m.peaks?.items).toEqual([{ at: 9, peakDb: -0.9 }]);
      expect(m.loudness?.truePeakDbfs).toBeCloseTo(-0.9, 0);
      expect(m.loudness?.integratedLufs).toBe(-16);
      expect(m.palette.items.map((colour) => colour.share)).toEqual([0.333, 0.25, 0.25, 0.167]);
      expect(m.palette.items[0]?.hex).toMatch(/^#0[0-2]0[0-2]F[D-F]$/);
      expect(m.keyframes.map((frame) => [frame.id, frame.at])).toEqual([
        ['k-001', 1.5],
        ['k-002', 5],
        ['k-003', 8],
        ['k-004', 10.5],
      ]);
      expect(m.hookSheet).toMatchObject({ file: 'hook.jpg', toSeconds: 12 });
      expect(m.problems).toEqual([]);
      // What is measured is kept as JSON and must read back whole.
      expect(parseMeasurements(JSON.stringify(m))).toEqual(m);
      expect(m.motion?.transitionCounts).toMatchObject({ cut: 3, dissolve: 0, flash: 0 });
      expect(m.motion?.cameraCounts.static).toBe(4);
      expect(m.motion?.frames).toBe(300);
      const files = readdirSync(folder).sort();
      expect(files).toEqual(['hook.jpg', 'k-001.jpg', 'k-002.jpg', 'k-003.jpg', 'k-004.jpg']);
      const hook = readFileSync(join(folder, 'hook.jpg'));
      expect([hook[0], hook[1]]).toEqual([0xff, 0xd8]);
    },
    60_000,
  );

  test.skipIf(!real)(
    'a steady 1 kHz tone at -20 dBFS reads -23 LUFS integrated and -20 dBFS true peak',
    async () => {
      const tone = join(root, 'tone.mkv');
      execFileSync(ffmpeg ?? '', [
        ...['-hide_banner', '-loglevel', 'error', '-y'],
        ...['-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=10'],
        ...['-f', 'lavfi', '-i', "aevalsrc='0.1*sin(2*PI*1000*t)':s=48000:d=10"],
        ...['-c:v', 'libx264', '-c:a', 'pcm_s16le', '-shortest', tone],
      ]);
      const folder = join(root, 'teardown-tone');
      mkdirSync(folder, { recursive: true });
      const measured = await measureVideo(tone, folder);
      expect(measured.ok && measured.measurements.loudness).toMatchObject({
        integratedLufs: -23,
        truePeakDbfs: -20,
      });
      expect(measured.ok && measured.measurements.quietDips?.items).toEqual([]);
      expect(measured.ok && measured.measurements.shots.cutCount).toBe(0);
      expect(existsSync(join(folder, 'k-001.jpg'))).toBe(true);
    },
    60_000,
  );
});

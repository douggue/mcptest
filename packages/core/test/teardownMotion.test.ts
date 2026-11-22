import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { findProgram } from '../src/downloads/program';
import { classifyMotion, type MotionFindings } from '../src/teardown/motionClassify';
import {
  compareFrames,
  profileMotion,
  thumbDifference,
  thumbnail,
} from '../src/teardown/motionFrames';
import { frameStreamArgs, readFrameStream } from '../src/teardown/motionStream';
import { measureMotion } from '../src/teardown/measureMotion';
import { motionEvents, planStrips, stripArgs } from '../src/teardown/strips';

const FPS = 25;
let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-motion-'));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('comparing frames', () => {
  test('a plain frame has nothing to follow, and the first frame has no change', () => {
    const flat = new Uint8Array(160 * 90).fill(40);
    expect(compareFrames(null, flat, 0)).toEqual({
      t: 0,
      diff: 0,
      luma: 40,
      dx: 0,
      dy: 0,
      zoom: 1,
    });
    expect(compareFrames(flat, flat, 0.04)).toMatchObject({ diff: 0, dx: 0, dy: 0, zoom: 1 });
    expect(profileMotion(new Float64Array(10), new Float64Array(10))).toEqual({
      shift: 0,
      zoom: 1,
    });
  });

  test('a picture moved three pixels left reads as content moving left', () => {
    const width = 160;
    const height = 90;
    const picture = (offset: number): Uint8Array =>
      Uint8Array.from({ length: width * height }, (_, index) => {
        const x = (index % width) + offset;
        return Math.round(128 + 100 * Math.sin(x / 7) * Math.cos(Math.floor(index / width) / 9));
      });
    const sample = compareFrames(picture(0), picture(3), 0.04);
    expect(sample.dx).toBeCloseTo(-3, 0);
    expect(Math.abs(sample.dy)).toBeLessThan(0.5);
    const tiny = thumbnail(picture(0));
    expect(tiny).toHaveLength(32 * 18);
    expect(thumbDifference(tiny, tiny)).toBe(0);
  });
});

describe('classifying samples', () => {
  const steady = (count: number, luma = 120, diff = 0) =>
    Array.from({ length: count }, (_, index) => ({
      t: index / FPS,
      diff,
      luma,
      dx: 0,
      dy: 0,
      zoom: 1,
    }));
  const thumbsFor = (count: number) => Array.from({ length: count }, () => new Uint8Array(4));
  const classify = (samples: ReturnType<typeof steady>, cuts: number[] = []): MotionFindings =>
    classifyMotion({
      samples,
      thumbs: thumbsFor(samples.length),
      fps: FPS,
      cuts,
      shots: [{ start: 0, end: samples.length / FPS }],
    });

  test('a cut from the scene pass is a cut; a long still stretch is a hold', () => {
    const findings = classify(steady(100), [2]);
    expect(findings.transitions).toEqual([
      { kind: 'cut', start: 2, end: 2.04, startFrame: 50, endFrame: 50, frames: 1 },
    ]);
    expect(findings.holds).toHaveLength(1);
    expect(findings.shots[0]).toMatchObject({ camera: 'static', intensity: 0 });
  });

  test('a cut inside a flash counts as the flash', () => {
    const samples = steady(60).map((sample, index) =>
      index === 30 ? { ...sample, luma: 250, diff: 50 } : sample,
    );
    const findings = classify(samples, [1.2]);
    expect(findings.transitions.map((item) => item.kind)).toEqual(['flash']);
  });

  test('a shaking camera is called shake', () => {
    const samples = steady(50).map((sample, index) => ({
      ...sample,
      dx: index % 2 === 0 ? 2 : -2,
      diff: 1,
    }));
    expect(classify(samples).shots[0]?.camera).toBe('shake');
  });

  test('motion events skip cuts and still shots; strips favour the opening then each kind', () => {
    const findings: MotionFindings = {
      transitions: [
        { kind: 'cut', start: 1, end: 1.04, startFrame: 25, endFrame: 25, frames: 1 },
        { kind: 'dissolve', start: 40, end: 41, startFrame: 1000, endFrame: 1024, frames: 25 },
        { kind: 'flash', start: 2, end: 2.04, startFrame: 50, endFrame: 50, frames: 1 },
      ],
      holds: [],
      animations: Array.from({ length: 6 }, (_, index) => ({
        start: 100 + index,
        end: 100.4 + index,
        startFrame: 2500 + index * 25,
        endFrame: 2509 + index * 25,
        frames: 10,
        change: 2,
      })),
      shots: [
        {
          shot: 0,
          start: 0,
          end: 10,
          camera: 'static',
          panPerSecond: 0,
          tiltPerSecond: 0,
          zoomPerSecond: 0,
          intensity: 0,
        },
        {
          shot: 1,
          start: 50,
          end: 60,
          camera: 'push-in',
          panPerSecond: 0,
          tiltPerSecond: 0,
          zoomPerSecond: 3,
          intensity: 1,
        },
      ],
    };
    const events = motionEvents(findings, FPS);
    expect(events.map((event) => event.kind)).toEqual([
      'flash',
      'dissolve',
      'push-in',
      ...Array(6).fill('animation'),
    ]);
    expect(events[2]).toMatchObject({ start: 54, end: 56, startFrame: 1350, frames: 50 });
    const strips = planStrips(events);
    expect(strips.map((strip) => [strip.id, strip.kind])).toEqual([
      ['s-001', 'flash'],
      ['s-002', 'dissolve'],
      ['s-003', 'push-in'],
      ['s-004', 'animation'],
      ['s-005', 'animation'],
      ['s-006', 'animation'],
    ]);
    expect(strips[0]).toMatchObject({ fromFrame: 46, step: 1 });
    expect(strips[1]).toMatchObject({ fromFrame: 1000, step: 3 });
    expect(planStrips(events, 2)).toHaveLength(2);
  });

  test('argument lists take absolute paths only', () => {
    expect(() => stripArgs('a.mp4', 0, 1, '/s.jpg')).toThrow(/absolute/);
    expect(() => frameStreamArgs('a.mp4')).toThrow(/absolute/);
    expect(stripArgs('/a.mp4', 1.5, 3, '/s.jpg').join(' ')).toContain("select='not(mod(n,3))'");
  });
});

describe('reading frames', () => {
  test('frames arriving in odd pieces are put back together; a failed run gives nothing', async () => {
    const frame = new Uint8Array(160 * 90).fill(90);
    const both = Buffer.concat([Buffer.from(frame), Buffer.from(frame.map(() => 100))]);
    const read = await readFrameStream(
      '/ffmpeg',
      '/a.mp4',
      FPS,
      async (_program, _args, onData) => {
        onData(both.subarray(0, 1000));
        onData(both.subarray(1000));
        return 0;
      },
    );
    expect(read?.samples.map((sample) => [sample.t, sample.luma])).toEqual([
      [0, 90],
      [0.04, 100],
    ]);
    expect(await readFrameStream('/ffmpeg', '/a.mp4', FPS, async () => 1)).toBeNull();
  });

  test('measureMotion gives nothing when the frames cannot be read', async () => {
    const tools = {
      ffmpeg: '/ffmpeg',
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
      stream: async () => 1,
    };
    expect(await measureMotion(tools, '/a.mp4', root, 25, [], [{ start: 0, end: 1 }])).toBeNull();
  });
});

describe('with the real ffmpeg, on generated clips with known motion', async () => {
  const ffmpeg = await findProgram('ffmpeg');
  const run = (args: string[]): void => {
    execFileSync(ffmpeg ?? '', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  };
  let still = '';
  let bars = '';

  /** A still picture with detail everywhere, and a second, different one. */
  const stills = (): void => {
    if (still !== '') return;
    still = join(root, 'still.png');
    bars = join(root, 'bars.png');
    run(['-f', 'lavfi', '-i', 'mandelbrot=s=1280x720', '-frames:v', '1', still]);
    run(['-f', 'lavfi', '-i', 'smptebars=s=640x360', '-frames:v', '1', bars]);
  };
  const encode = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
  const loop = (seconds: number): string[] => [
    '-loop',
    '1',
    '-framerate',
    String(FPS),
    '-t',
    String(seconds),
    '-i',
    still,
  ];

  async function findingsOf(path: string, cuts: number[] = []) {
    const read = await readFrameStream(ffmpeg ?? '', path, FPS);
    if (read === null) throw new Error('no frames');
    const end = read.samples.length / FPS;
    return classifyMotion({
      samples: read.samples,
      thumbs: read.thumbs,
      fps: FPS,
      cuts,
      shots: [{ start: 0, end }],
    });
  }

  test.skipIf(ffmpeg === null)(
    'a pan, a tilt and a push-in are told apart, with their speed',
    async () => {
      stills();
      const pan = join(root, 'pan.mp4');
      run([...loop(4), '-vf', "crop=640:360:x='t*100':y=180", ...encode, pan]);
      const tilt = join(root, 'tilt.mp4');
      run([...loop(4), '-vf', "crop=640:360:x=320:y='t*60'", ...encode, tilt]);
      const zoom = join(root, 'zoom.mp4');
      run([
        ...['-loop', '1', '-framerate', String(FPS), '-i', still],
        ...[
          '-vf',
          "zoompan=z='1+0.004*on':d=100:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=640x360:fps=25",
        ],
        ...['-frames:v', '100', ...encode, zoom],
      ]);
      const panned = (await findingsOf(pan)).shots[0];
      // 100 pixels a second across a 640-pixel frame is 15.6% of the width a second.
      expect(panned?.camera).toBe('pan-right');
      expect(panned?.panPerSecond).toBeGreaterThan(14);
      expect(panned?.panPerSecond).toBeLessThan(17);
      const tilted = (await findingsOf(tilt)).shots[0];
      expect(tilted?.camera).toBe('tilt-down');
      expect(tilted?.tiltPerSecond).toBeGreaterThan(12);
      const zoomed = (await findingsOf(zoom)).shots[0];
      expect(zoomed?.camera).toBe('push-in');
      expect(zoomed?.zoomPerSecond).toBeGreaterThan(4);
    },
    60_000,
  );

  test.skipIf(ffmpeg === null)(
    'a dissolve, fades to and from black, a flash, a whip and a sliding graphic are each found where they are',
    async () => {
      stills();
      const dissolve = join(root, 'dissolve.mp4');
      run([
        ...loop(3),
        ...['-loop', '1', '-framerate', String(FPS), '-t', '3', '-i', bars],
        ...[
          '-filter_complex',
          '[0]scale=640:360,setsar=1,format=yuv420p[a];[1]setsar=1,format=yuv420p[b];[a][b]xfade=transition=fade:duration=1:offset=1.5',
        ],
        ...encode,
        dissolve,
      ]);
      const dissolved = (await findingsOf(dissolve)).transitions;
      expect(dissolved).toHaveLength(1);
      expect(dissolved[0]).toMatchObject({ kind: 'dissolve', start: 1.56, frames: 25 });

      const plain = join(root, 'plain.mp4');
      run([...loop(4), '-vf', 'scale=640:360', ...encode, plain]);
      const fade = join(root, 'fade.mp4');
      run([
        ...['-i', plain, '-filter_complex'],
        '[0]split[a][b];[a]trim=0:2,setpts=PTS-STARTPTS,fade=t=out:st=1:d=1[x];[b]trim=0:2,setpts=PTS-STARTPTS,fade=t=in:st=0.4:d=0.8[y];[x][y]concat=n=2:v=1[v]',
        ...['-map', '[v]', ...encode, fade],
      ]);
      const faded = (await findingsOf(fade)).transitions;
      expect(faded.map((item) => item.kind)).toEqual(['fade-black', 'fade-black']);
      expect(faded[0]?.start).toBeCloseTo(1, 1);
      expect(faded[1]?.end).toBeCloseTo(3.2, 0);

      const flash = join(root, 'flash.mp4');
      run(['-i', plain, '-vf', "drawbox=c=white:t=fill:enable='eq(n,50)'", ...encode, flash]);
      expect((await findingsOf(flash, [2, 2.04])).transitions).toEqual([
        { kind: 'flash', start: 2, end: 2.04, startFrame: 50, endFrame: 50, frames: 1 },
      ]);

      const whip = join(root, 'whip.mp4');
      run([
        ...loop(4),
        '-vf',
        "crop=640:360:x='if(between(n,50,55),(n-50)*120,if(gt(n,55),600,0))':y=180",
        ...encode,
        whip,
      ]);
      expect(
        (await findingsOf(whip)).transitions.map((item) => [
          item.kind,
          item.startFrame,
          item.frames,
        ]),
      ).toEqual([['whip', 51, 5]]);

      const slide = join(root, 'slide.mp4');
      run([
        ...['-i', plain, '-f', 'lavfi', '-i', `color=c=red:s=80x20:r=${FPS}:d=4`],
        ...[
          '-filter_complex',
          "[0][1]overlay=x='if(lt(t,1),-100,min(500,40+(t-1)*600))':y=300",
          '-t',
          '3',
        ],
        ...encode,
        slide,
      ]);
      const slid = await findingsOf(slide);
      expect(slid.transitions).toEqual([]);
      expect(slid.animations).toHaveLength(1);
      expect(slid.animations[0]?.start).toBeCloseTo(1, 0);
      expect(slid.animations[0]?.end).toBeCloseTo(1.8, 0);
    },
    90_000,
  );

  test.skipIf(ffmpeg === null)(
    'measureMotion cuts a strip of frames around the events it chose',
    async () => {
      stills();
      const flash = join(root, 'flash-strip.mp4');
      run([
        ...loop(4),
        '-vf',
        "scale=640:360,drawbox=c=white:t=fill:enable='eq(n,50)'",
        ...encode,
        flash,
      ]);
      const folder = mkdtempSync(join(root, 'strips-'));
      const { programRunner } = await import('../src/downloads/program');
      const motion = await measureMotion(
        { ffmpeg: ffmpeg ?? '', run: programRunner(60_000) },
        flash,
        folder,
        FPS,
        [],
        [{ start: 0, end: 4 }],
      );
      expect(motion?.transitionCounts).toMatchObject({ flash: 1, cut: 0, dissolve: 0 });
      expect(motion?.strips).toEqual([
        expect.objectContaining({
          id: 's-001',
          kind: 'flash',
          file: 's-001.jpg',
          fromFrame: 46,
          step: 1,
        }),
      ]);
      expect(readdirSync(folder)).toEqual(['s-001.jpg']);
      expect(motion?.cameraCounts.static).toBe(1);
    },
    60_000,
  );
});

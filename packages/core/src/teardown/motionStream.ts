import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import {
  ANALYSIS_HEIGHT,
  ANALYSIS_WIDTH,
  compareFrames,
  thumbnail,
  type FrameSample,
} from './motionFrames';

/**
 * Every frame of a video, read once from ffmpeg as small grey pictures on its
 * standard output and compared as it arrives, so even a long video never
 * sits in memory: only one sample and one tiny copy per frame are kept.
 */

export interface FrameStream {
  readonly samples: readonly FrameSample[];
  readonly thumbs: readonly Uint8Array[];
}

/** Starts a program and hands its standard output over in pieces; tests replace it. */
export type StreamProgram = (
  program: string,
  args: readonly string[],
  onData: (chunk: Buffer) => void,
  signal?: AbortSignal,
) => Promise<number | null>;

const FRAME_BYTES = ANALYSIS_WIDTH * ANALYSIS_HEIGHT;
/** Reading every frame of a long video takes minutes; longer than this has stalled. */
const STREAM_TIMEOUT_MS = 30 * 60 * 1000;

export function frameStreamArgs(path: string): string[] {
  if (!isAbsolute(path)) throw new Error('ffmpeg is only given absolute paths');
  return [
    ...['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error', '-i', path, '-an', '-sn'],
    ...[
      '-vf',
      `scale=${ANALYSIS_WIDTH}:${ANALYSIS_HEIGHT},format=gray`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-',
    ],
  ];
}

export const streamProgram: StreamProgram = (program, args, onData, signal) =>
  new Promise((resolve) => {
    const child = spawn(program, [...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), STREAM_TIMEOUT_MS);
    child.stdout.on('data', onData);
    child.on('error', () => undefined);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

/** Reads and compares every frame; null when ffmpeg failed. */
export async function readFrameStream(
  ffmpeg: string,
  path: string,
  fps: number,
  run: StreamProgram = streamProgram,
  signal?: AbortSignal,
): Promise<FrameStream | null> {
  const samples: FrameSample[] = [];
  const thumbs: Uint8Array[] = [];
  let pending: Buffer = Buffer.alloc(0);
  let previous: Uint8Array | null = null;
  const take = (frame: Uint8Array): void => {
    samples.push(compareFrames(previous, frame, Math.round((samples.length / fps) * 1000) / 1000));
    thumbs.push(thumbnail(frame));
    previous = frame;
  };
  const code = await run(
    ffmpeg,
    frameStreamArgs(path),
    (chunk) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length >= FRAME_BYTES) {
        take(new Uint8Array(pending.subarray(0, FRAME_BYTES)));
        pending = pending.subarray(FRAME_BYTES);
      }
    },
    signal,
  );
  return code === 0 && samples.length > 1 ? { samples, thumbs } : null;
}

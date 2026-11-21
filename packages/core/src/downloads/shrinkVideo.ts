import { mkdir, rm, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import { pathInside, pathInsideAny } from './folder';
import { durationFrom, findFfmpeg } from './frameSheets';
import { programRunner, type RunProgram } from './program';
import { videoTempFolder } from './videoFile';

/**
 * Makes a smaller copy of a video for an engine that will not open a large
 * file, with ffmpeg, when the owner has it installed. The owner's own copy of
 * a video may be full quality and far over the limit; the copy is for the
 * watch only, sits in the temporary folder and is removed afterwards. The
 * original is only read.
 *
 * The method, in one attempt: the picture is scaled to 360 lines (never up),
 * and the bitrate is worked out from the video's length so that picture and
 * sound together come to nine tenths of the size limit.
 */

/** The picture height of the copy: what YouTube's own smallest file with sound has. */
export const SHRINK_HEIGHT = 360;
/** Bits a second for the sound: enough for speech and music to be judged. */
export const SHRINK_AUDIO_BITS = 64_000;
/** Bits a second below which a 360-line picture is too blocky to study. */
export const SHRINK_MIN_VIDEO_BITS = 100_000;
/** Bits a second beyond which a 360-line picture gains nothing. */
export const SHRINK_MAX_VIDEO_BITS = 700_000;
/** The part of the size limit aimed for; the rest is room for the file's own bookkeeping. */
const SHRINK_AIM = 0.9;
const BITS_PER_BYTE = 8;
/** Re-encoding an hour of video takes minutes; longer than this has stalled. */
const SHRINK_TIMEOUT_MS = 30 * 60 * 1000;
const PROBE_TIMEOUT_MS = 30_000;
const SMALL_SUFFIX = '.small.mp4';

export interface ShrinkPlan {
  readonly videoBitsPerSecond: number;
}

/**
 * The bitrate for the picture of a copy that fits `maxBytes`, or null when
 * the video is so long that the picture would be unwatchable.
 */
export function shrinkPlan(durationSeconds: number, maxBytes: number): ShrinkPlan | null {
  if (!(durationSeconds > 0)) return null;
  const total = ((maxBytes * BITS_PER_BYTE) / durationSeconds) * SHRINK_AIM;
  const video = Math.min(SHRINK_MAX_VIDEO_BITS, Math.floor(total - SHRINK_AUDIO_BITS));
  return video >= SHRINK_MIN_VIDEO_BITS ? { videoBitsPerSecond: video } : null;
}

/** The arguments ffmpeg is started with to write the smaller copy. */
export function shrinkArguments(input: string, output: string, videoBits: number): string[] {
  if (!isAbsolute(input) || !isAbsolute(output)) {
    throw new Error('ffmpeg is only given absolute paths');
  }
  return [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-y',
    '-i',
    input,
    '-vf',
    `scale=-2:'min(${SHRINK_HEIGHT},ih)'`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-b:v',
    String(videoBits),
    '-maxrate',
    String(videoBits),
    '-bufsize',
    String(videoBits * 2),
    '-c:a',
    'aac',
    '-b:a',
    String(SHRINK_AUDIO_BITS),
    '-movflags',
    '+faststart',
    output,
  ];
}

export type ShrunkVideo =
  | { readonly ok: true; readonly path: string; readonly bytes: number }
  | { readonly ok: false; readonly reason: string };

export interface ShrinkOptions {
  /** The downloads folder (`downloadsRoot`); the copy goes into its temporary area. */
  readonly root: string;
  /** The largest file the engine that watches will open. */
  readonly maxBytes: number;
  /** The folders the original may be in, besides the temporary one. */
  readonly alsoFrom?: readonly string[];
  /** Where to look for ffmpeg; tests replace these. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  /** Replaces starting ffmpeg; used by tests. */
  readonly run?: RunProgram;
  /** Aborted when Jgtube is closing: an ffmpeg that is running is stopped. */
  readonly signal?: AbortSignal;
}

/**
 * Writes a smaller copy of one video into the temporary folder, for watching
 * only, and says where it is. The caller removes it after use. Nothing is
 * left behind when it cannot be made.
 */
export async function shrinkForWatching(
  video: { readonly videoId: string; readonly path: string },
  options: ShrinkOptions,
): Promise<ShrunkVideo> {
  if (!VIDEO_ID_PATTERN.test(video.videoId)) {
    throw new Error(`Not a valid YouTube video id: "${video.videoId.slice(0, 40)}"`);
  }
  const temp = videoTempFolder(options.root);
  const source = pathInsideAny([temp, ...(options.alsoFrom ?? [])], video.path);
  const output = pathInside(temp, `${video.videoId}${SMALL_SUFFIX}`);
  const program = await findFfmpeg(options.env, options.platform);
  if (program === null) return { ok: false, reason: 'ffmpeg is not installed on this computer' };
  const fail = async (reason: string): Promise<ShrunkVideo> => {
    await rm(output, { force: true });
    return { ok: false, reason };
  };
  // Asked only about the file, ffmpeg prints its length and ends with an error of its own.
  const probe = options.run ?? programRunner(PROBE_TIMEOUT_MS);
  const told = await probe(program, ['-hide_banner', '-nostdin', '-i', source], options.signal);
  const seconds = durationFrom(told.stderr);
  if (seconds === null) return fail('ffmpeg could not tell how long the video is');
  const plan = shrinkPlan(seconds, options.maxBytes);
  if (plan === null) return fail('the video is too long to make a watchable copy that small');
  await mkdir(temp, { recursive: true });
  const run = options.run ?? programRunner(SHRINK_TIMEOUT_MS);
  const args = shrinkArguments(source, output, plan.videoBitsPerSecond);
  const result = await run(program, args, options.signal);
  if (options.signal?.aborted) return fail('it was stopped because Jgtube is closing');
  if (result.code !== 0) return fail('ffmpeg could not make the smaller copy');
  const bytes = (await stat(output).catch(() => null))?.size ?? 0;
  if (bytes === 0) return fail('ffmpeg could not make the smaller copy');
  if (bytes > options.maxBytes) return fail('the smaller copy still came out over the size limit');
  return { ok: true, path: output, bytes };
}

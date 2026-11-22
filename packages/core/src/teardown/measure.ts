import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { findProgram, programRunner, type RunProgram } from '../downloads/program';
import { pathInside } from '../downloads/folder';
import {
  HOOK_COLUMNS,
  HOOK_ROWS,
  OPENING_SECONDS,
  MEASURE_TIMEOUT_MS,
  PEAK_DB,
  QUIET_DB,
  QUIET_MIN_SECONDS,
  SCENE_THRESHOLD,
} from './constants';
import {
  hookSheetArgs,
  keyframeArgs,
  loudnessArgs,
  peakArgs,
  peakWindowSeconds,
  probeArgs,
  sceneArgs,
  silenceArgs,
} from './ffmpegArgs';
import { planKeyframes, type PlannedKeyframe } from './keyframes';
import type { TeardownMeasurements } from './measurements';
import { dominantColours, type WeightedPixels } from './palette';
import {
  parseEbur128,
  parsePeakWindows,
  parseProbe,
  parseSceneCuts,
  parseSilences,
  peakImpacts,
  type ProbedVideo,
} from './parse';
import { shotSpans, shotStats } from './shots';
import { measureMotion } from './measureMotion';
import type { StreamProgram } from './motionStream';

/**
 * Measures one video file in code with ffprobe and ffmpeg: its length, size
 * and frame rate; its cuts and shot lengths; its loudness, quiet dips and
 * peak impacts; its keyframes and their colours; and a contact sheet of its
 * opening. The pictures are written into `folder`; the numbers come back
 * with the method each was measured by. Nothing here is judged by a model.
 */

export interface MeasureOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  /** Replaces starting the programs; used by tests. */
  readonly run?: RunProgram;
  /** Replaces starting ffmpeg for the frame-by-frame pass; used by tests. */
  readonly stream?: StreamProgram;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
  /** Says which measurement is under way. */
  readonly onStep?: (text: string) => void;
}

export type Measured =
  | { readonly ok: true; readonly measurements: TeardownMeasurements }
  | { readonly ok: false; readonly reason: string };

interface Tools {
  readonly ffmpeg: string;
  readonly ffprobe: string;
  readonly run: RunProgram;
  readonly stream?: StreamProgram | undefined;
  readonly signal?: AbortSignal | undefined;
}

const KEYFRAME_FILE = (id: string): string => `${id}.jpg`;
export const HOOK_SHEET_FILE = 'hook.jpg';

/** ffprobe on the PATH, else beside ffmpeg (an owner who named ffmpeg's path has ffprobe there). */
async function findFfprobe(ffmpeg: string, options: MeasureOptions): Promise<string | null> {
  const found = await findProgram('ffprobe', options.env, options.platform);
  if (found !== null) return found;
  const windows = (options.platform ?? process.platform) === 'win32';
  const beside = join(dirname(ffmpeg), windows ? 'ffprobe.exe' : 'ffprobe');
  return (await findProgram('ffprobe', { PATH: dirname(beside) }, options.platform)) === null
    ? null
    : beside;
}

async function runFor(tools: Tools, program: string, args: readonly string[]) {
  const result = await tools.run(program, args, tools.signal);
  if (tools.signal?.aborted) throw new Error('the measuring was stopped because Jgtube is closing');
  return result;
}

async function probe(tools: Tools, path: string): Promise<ProbedVideo | null> {
  const result = await runFor(tools, tools.ffprobe, probeArgs(path));
  return result.code === 0 ? parseProbe(result.stdout) : null;
}

/** One ffmpeg pass that reads only what it prints; null when ffmpeg failed. */
async function printed(tools: Tools, args: readonly string[]): Promise<string | null> {
  const result = await runFor(tools, tools.ffmpeg, args);
  return result.code === 0 ? result.stderr : null;
}

const methods = {
  video: 'ffprobe: container length, first video stream size and average frame rate',
  shots: `ffmpeg scene detection: select='gt(scene,${SCENE_THRESHOLD})' with showinfo; a shot is the time between two detected cuts`,
  loudness: 'ffmpeg ebur128 filter (EBU R128): integrated loudness, loudness range, true peak',
  quiet: `ffmpeg silencedetect: below ${QUIET_DB} dBFS for at least ${QUIET_MIN_SECONDS} s`,
  peaks: (window: number) =>
    `ffmpeg astats peak level in ${window} s windows: a window above ${PEAK_DB} dBFS after one at or below it`,
  palette:
    'k-means (8 groups, fixed start) over every keyframe shrunk to 48×27 pixels, each weighted by the seconds of video its shots last; colours under 2% left out',
  hook: `ffmpeg: the first ${OPENING_SECONDS} s, one frame a second, ${HOOK_COLUMNS}×${HOOK_ROWS} on one sheet`,
};

async function measureAudio(tools: Tools, path: string, video: ProbedVideo) {
  if (!video.hasAudio)
    return { loudness: null, quietDips: null, peaks: null, problems: ['It has no sound track.'] };
  const problems: string[] = [];
  const loudnessText = await printed(tools, loudnessArgs(path));
  const loudness =
    loudnessText === null ? null : { ...parseEbur128(loudnessText), method: methods.loudness };
  if (loudness === null) problems.push('Its loudness could not be measured.');
  const quietText = await printed(tools, silenceArgs(path));
  const quietDips =
    quietText === null
      ? null
      : {
          thresholdDb: QUIET_DB,
          minSeconds: QUIET_MIN_SECONDS,
          items: [...parseSilences(quietText, video.durationSeconds)],
          method: methods.quiet,
        };
  if (quietDips === null) problems.push('Its quiet dips could not be measured.');
  const window = peakWindowSeconds(video.durationSeconds);
  const peakText = await printed(tools, peakArgs(path, window));
  const peaks =
    peakText === null
      ? null
      : {
          thresholdDb: PEAK_DB,
          windowSeconds: window,
          items: peakImpacts(parsePeakWindows(peakText), PEAK_DB).filter((item) =>
            Number.isFinite(item.peakDb),
          ),
          method: methods.peaks(window),
        };
  if (peaks === null) problems.push('Its peak impacts could not be measured.');
  return { loudness, quietDips, peaks, problems };
}

/** Each keyframe as a JPEG in the folder, with its tiny raw copy read for colours and removed. */
async function cutKeyframes(
  tools: Tools,
  path: string,
  folder: string,
  planned: readonly PlannedKeyframe[],
) {
  const kept: { readonly frame: PlannedKeyframe; readonly pixels: WeightedPixels }[] = [];
  for (const frame of planned) {
    const jpeg = pathInside(folder, KEYFRAME_FILE(frame.id));
    const rgb = pathInside(folder, `${frame.id}.rgb`);
    const result = await runFor(tools, tools.ffmpeg, keyframeArgs(path, frame.at, jpeg, rgb));
    const bytes = result.code === 0 ? await readFile(rgb).catch(() => null) : null;
    await rm(rgb, { force: true });
    if (bytes !== null && bytes.length > 0)
      kept.push({ frame, pixels: { rgb: new Uint8Array(bytes), weight: frame.covers } });
  }
  return kept;
}

async function cutHookSheet(tools: Tools, path: string, folder: string, video: ProbedVideo) {
  const result = await runFor(
    tools,
    tools.ffmpeg,
    hookSheetArgs(path, pathInside(folder, HOOK_SHEET_FILE)),
  );
  if (result.code !== 0) return null;
  return {
    file: HOOK_SHEET_FILE,
    fromSeconds: 0,
    toSeconds: Math.min(OPENING_SECONDS, Math.floor(video.durationSeconds)),
    columns: HOOK_COLUMNS,
    rows: HOOK_ROWS,
    method: methods.hook,
  };
}

async function measureWith(
  tools: Tools,
  path: string,
  folder: string,
  options: MeasureOptions,
): Promise<Measured> {
  const say = options.onStep ?? (() => undefined);
  say('Reading its length, size and frame rate');
  const video = await probe(tools, path);
  if (video === null) return { ok: false, reason: 'ffprobe could not read the length of the file' };
  say('Finding every cut');
  const sceneText = await printed(tools, sceneArgs(path));
  if (sceneText === null) return { ok: false, reason: 'ffmpeg could not go through its pictures' };
  const cuts = parseSceneCuts(sceneText).filter((cut) => cut < video.durationSeconds);
  const shots = shotSpans(cuts, video.durationSeconds);
  say('Measuring its loudness, quiet dips and peaks');
  const audio = await measureAudio(tools, path, video);
  say('Taking one keyframe per shot and counting its colours');
  await mkdir(folder, { recursive: true });
  const keyframes = await cutKeyframes(tools, path, folder, planKeyframes(shots));
  const hookSheet = await cutHookSheet(tools, path, folder, video);
  say('Going through every frame for transitions, animation and camera moves');
  const motion = await measureMotion(tools, path, folder, video.fps, cuts, shots);
  const { loudness, quietDips, peaks, problems } = audio;
  return {
    ok: true,
    measurements: {
      version: 1,
      measuredAt: (options.now ?? (() => new Date()))().toISOString(),
      video: { ...video, method: methods.video },
      shots: {
        threshold: SCENE_THRESHOLD,
        cuts: [...cuts],
        ...shotStats(cuts, { start: 0, end: video.durationSeconds }),
        method: methods.shots,
      },
      loudness,
      quietDips,
      peaks,
      palette: {
        items: [...dominantColours(keyframes.map((entry) => entry.pixels))],
        method: methods.palette,
      },
      keyframes: keyframes.map(({ frame }) => ({ ...frame, file: KEYFRAME_FILE(frame.id) })),
      hookSheet,
      motion,
      problems: [
        ...problems,
        ...(keyframes.length === 0 ? ['No keyframe could be taken.'] : []),
        ...(hookSheet === null ? ['The opening could not be put on a sheet.'] : []),
        ...(motion === null ? ['Its frames could not be gone through one by one.'] : []),
      ],
    },
  };
}

/** Measures a video file, writing its pictures into `folder`. Never throws for a failed program. */
export async function measureVideo(
  path: string,
  folder: string,
  options: MeasureOptions = {},
): Promise<Measured> {
  const ffmpeg = await findProgram('ffmpeg', options.env, options.platform);
  if (ffmpeg === null) return { ok: false, reason: 'ffmpeg is not installed on this computer' };
  const ffprobe = await findFfprobe(ffmpeg, options);
  if (ffprobe === null)
    return { ok: false, reason: 'ffprobe (part of ffmpeg) is not installed on this computer' };
  const tools: Tools = {
    ffmpeg,
    ffprobe,
    run: options.run ?? programRunner(MEASURE_TIMEOUT_MS),
    stream: options.stream,
    signal: options.signal,
  };
  try {
    return await measureWith(tools, path, folder, options);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

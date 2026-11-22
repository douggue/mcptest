import { isAbsolute } from 'node:path';
import {
  COLOUR_SAMPLE_HEIGHT,
  COLOUR_SAMPLE_WIDTH,
  HOOK_COLUMNS,
  HOOK_ROWS,
  OPENING_SECONDS,
  KEYFRAME_WIDTH,
  MAX_PEAK_WINDOWS,
  PEAK_SAMPLE_RATE,
  PEAK_WINDOW_SECONDS,
  QUIET_DB,
  QUIET_MIN_SECONDS,
  SCENE_THRESHOLD,
  SHEET_TILE_HEIGHT,
  SHEET_TILE_WIDTH,
} from './constants';
import type { Span } from './parse';

/**
 * The argument lists ffprobe and ffmpeg are started with for each
 * measurement. Every path is absolute, so none can be read as an option, and
 * the programs are started directly, never through a shell.
 */

const QUIET = ['-hide_banner', '-nostdin', '-nostats'];
const NULL_OUTPUT = ['-f', 'null', '-'];
const JPEG_QUALITY = '4';

function absolute(...paths: readonly string[]): void {
  if (paths.some((path) => !isAbsolute(path)))
    throw new Error('ffmpeg is only given absolute paths');
}

const seconds = (value: number): string => value.toFixed(3);

export function probeArgs(path: string): string[] {
  absolute(path);
  return ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path];
}

export function sceneArgs(path: string, threshold = SCENE_THRESHOLD): string[] {
  absolute(path);
  return [
    ...QUIET,
    '-i',
    path,
    '-an',
    '-sn',
    '-vf',
    `select='gt(scene,${threshold})',showinfo`,
    ...NULL_OUTPUT,
  ];
}

export function loudnessArgs(path: string): string[] {
  absolute(path);
  return [
    ...QUIET,
    '-i',
    path,
    '-vn',
    '-sn',
    '-af',
    'ebur128=peak=true:framelog=verbose',
    ...NULL_OUTPUT,
  ];
}

export function silenceArgs(
  path: string,
  noiseDb = QUIET_DB,
  minSeconds = QUIET_MIN_SECONDS,
): string[] {
  absolute(path);
  return [
    ...QUIET,
    '-i',
    path,
    '-vn',
    '-sn',
    '-af',
    `silencedetect=noise=${noiseDb}dB:d=${minSeconds}`,
    ...NULL_OUTPUT,
  ];
}

/** The window peaks are measured in: half a second, longer for a long video so the lines stay few. */
export function peakWindowSeconds(durationSeconds: number): number {
  const needed = durationSeconds / MAX_PEAK_WINDOWS;
  return Math.max(PEAK_WINDOW_SECONDS, Math.ceil(needed * 10) / 10);
}

export function peakArgs(path: string, windowSeconds: number): string[] {
  absolute(path);
  const samples = Math.round(windowSeconds * PEAK_SAMPLE_RATE);
  const filter = [
    `aresample=${PEAK_SAMPLE_RATE}`,
    `asetnsamples=n=${samples}:p=0`,
    'astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level',
    'ametadata=mode=print:key=lavfi.astats.Overall.Peak_level',
  ].join(',');
  return [...QUIET, '-i', path, '-vn', '-sn', '-af', filter, ...NULL_OUTPUT];
}

/** One frame at `at`: a JPEG to show and a tiny raw RGB copy to count colours in. */
export function keyframeArgs(path: string, at: number, jpeg: string, rgb: string): string[] {
  absolute(path, jpeg, rgb);
  return [
    ...QUIET,
    '-y',
    '-ss',
    seconds(at),
    '-i',
    path,
    '-an',
    '-sn',
    ...['-frames:v', '1', '-vf', `scale=${KEYFRAME_WIDTH}:-2`, '-q:v', JPEG_QUALITY, jpeg],
    ...[
      '-frames:v',
      '1',
      '-vf',
      `scale=${COLOUR_SAMPLE_WIDTH}:${COLOUR_SAMPLE_HEIGHT}`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      rgb,
    ],
  ];
}

const tile = (columns: number, rows: number, fps: string): string =>
  [
    `fps=${fps}`,
    `scale=${SHEET_TILE_WIDTH}:${SHEET_TILE_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${SHEET_TILE_WIDTH}:${SHEET_TILE_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    `tile=${columns}x${rows}`,
  ].join(',');

/** The opening, one frame a second, on one sheet. */
export function hookSheetArgs(path: string, out: string): string[] {
  absolute(path, out);
  return [
    ...QUIET,
    '-y',
    '-t',
    String(OPENING_SECONDS),
    '-i',
    path,
    '-an',
    '-sn',
    '-vf',
    tile(HOOK_COLUMNS, HOOK_ROWS, '1'),
    '-frames:v',
    '1',
    '-q:v',
    JPEG_QUALITY,
    out,
  ];
}

/** One span (a chapter), `columns × rows` frames spread evenly across it, on one sheet. */
export function spanSheetArgs(
  path: string,
  span: Span,
  columns: number,
  rows: number,
  out: string,
): string[] {
  absolute(path, out);
  const length = Math.max(0.1, span.end - span.start);
  const fps = ((columns * rows) / length).toFixed(4);
  return [
    ...QUIET,
    '-y',
    '-ss',
    seconds(span.start),
    '-t',
    seconds(length),
    '-i',
    path,
    '-an',
    '-sn',
    '-vf',
    tile(columns, rows, fps),
    '-frames:v',
    '1',
    '-q:v',
    JPEG_QUALITY,
    out,
  ];
}

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { FetchedImage } from '../sources/images';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import type { VideoFrames } from '../video/frames';
import { describeSheet, spreadSheetNumbers, type FrameSheet } from '../video/storyboard';
import { pathInside, pathInsideAny } from './folder';
import { findProgram, programRunner, type RunProgram } from './program';
import { videoTempFolder } from './videoFile';

/**
 * Cuts a video file into contact sheets with ffmpeg, when the owner has it
 * installed: one frame for every second of the video, twenty-five to a sheet,
 * so that a model can go through the whole video picture by picture. The
 * sheets sit in a folder of their own inside the temporary folder, are looked
 * up by video id and sheet number only, and are removed with the video.
 *
 * ffmpeg is found on the PATH and started directly (never through a shell)
 * with its arguments as a list. Both paths it is given are whole paths from
 * the root of the disk, so neither can be read as an option.
 */

/** The program's name; on Windows its file is this with ".exe". */
export const FFMPEG_PROGRAM = 'ffmpeg';
/** One frame is kept for every this many seconds of video. */
export const FRAME_EVERY_SECONDS = 1;
/** Frames across and down one sheet. */
export const SHEET_COLUMNS = 5;
export const SHEET_ROWS = 5;
/**
 * The size of one frame on a sheet. Five of them make a sheet 1440 pixels
 * wide and 810 high: the largest that a model is shown as it is, without
 * being shrunk first, and at this size the words on screen can be read.
 */
export const SHEET_FRAME_WIDTH = 288;
export const SHEET_FRAME_HEIGHT = 162;
/**
 * The most sheets cut from one video: 2,000 frames, a little over half an
 * hour. The longest video the downloader hands over needs about fifty.
 */
export const MAX_FRAME_SHEETS = 80;
/** A sheet larger than this is not a sheet this module wrote. */
export const MAX_SHEET_BYTES = 2_000_000;
export const FRAME_SHEET_INDEX_FILE = 'index.json';
const FOLDER_PREFIX = 'frames-';
/** Cutting a twenty-minute video takes well under a minute; longer than this has stalled. */
const CUT_TIMEOUT_MS = 10 * 60 * 1000;
const JPEG_QUALITY = '5';
const SHEET_NAME = /^sheet-(\d{3})\.jpg$/;
const DURATION = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/;
const FRAMES_PER_SHEET = SHEET_COLUMNS * SHEET_ROWS;
const JSON_INDENT = 2;
const SECOND_MS = 1000;

const FILTER = [
  `fps=${1 / FRAME_EVERY_SECONDS}`,
  `scale=${SHEET_FRAME_WIDTH}:${SHEET_FRAME_HEIGHT}:force_original_aspect_ratio=decrease`,
  `pad=${SHEET_FRAME_WIDTH}:${SHEET_FRAME_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
  `tile=${SHEET_COLUMNS}x${SHEET_ROWS}`,
].join(',');

const sheetSchema = z.object({
  index: z.number().int().nonnegative(),
  file: z.string().regex(SHEET_NAME),
  frames: z.number().int().positive().max(FRAMES_PER_SHEET),
  firstSecond: z.number().int().nonnegative(),
  lastSecond: z.number().int().nonnegative(),
});
const indexSchema = z.object({
  videoId: z.string().regex(VIDEO_ID_PATTERN),
  cutAt: z.string(),
  everySeconds: z.number().positive(),
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  frameCount: z.number().int().positive(),
  sheets: z.array(sheetSchema).min(1).max(MAX_FRAME_SHEETS),
});

/** One sheet cut from a file, as the index lists it. */
export type CutSheet = z.infer<typeof sheetSchema>;
export type FrameSheetIndex = z.infer<typeof indexSchema>;

export type FrameSheetCut =
  | {
      readonly ok: true;
      /** The folder holding the sheets and their index, as an absolute path. */
      readonly folder: string;
      readonly sheetCount: number;
      readonly frameCount: number;
    }
  | { readonly ok: false; readonly reason: string };

export interface CutOptions {
  /** The downloads folder (`downloadsRoot`); the sheets go into its temporary area. */
  readonly root: string;
  readonly now?: () => Date;
  /** Where to look for ffmpeg; tests replace these. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  /** Replaces starting ffmpeg; used by tests. */
  readonly run?: RunProgram;
  /** Aborted when Jgtube is closing: an ffmpeg that is running is stopped. */
  readonly signal?: AbortSignal;
  /**
   * The folders a file to cut may be in, besides the temporary one: the
   * folder the owner puts their own copies in.
   */
  readonly alsoFrom?: readonly string[];
}

function requireVideoId(videoId: string): void {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
  }
}

/** The folder one video's sheets are kept in, inside the temporary folder. */
export function frameSheetFolder(root: string, videoId: string): string {
  requireVideoId(videoId);
  return pathInside(videoTempFolder(root), `${FOLDER_PREFIX}${videoId}`);
}

/** Where ffmpeg is on this computer, or null when it is not installed. Nothing is run to find out. */
export const findFfmpeg = (
  env?: Readonly<Record<string, string | undefined>>,
  platform?: NodeJS.Platform,
): Promise<string | null> => findProgram(FFMPEG_PROGRAM, env, platform);

/** The arguments ffmpeg is started with: one file read, numbered sheets written into `folder`. */
export function ffmpegArguments(videoPath: string, folder: string): string[] {
  if (!isAbsolute(videoPath) || !isAbsolute(folder)) {
    throw new Error('ffmpeg is only given absolute paths');
  }
  return [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-y',
    '-i',
    videoPath,
    '-an',
    '-sn',
    '-vf',
    FILTER,
    '-frames:v',
    String(MAX_FRAME_SHEETS),
    '-q:v',
    JPEG_QUALITY,
    join(folder, 'sheet-%03d.jpg'),
  ];
}

/** The video's length as ffmpeg printed it, in seconds; null when it did not say. */
export function durationFrom(stderr: string): number | null {
  const match = DURATION.exec(stderr);
  if (!match) return null;
  const [hours, minutes, seconds] = [match[1], match[2], match[3]].map(Number);
  const total = (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0);
  return Number.isFinite(total) && total > 0 ? total : null;
}

const isJpeg = (bytes: Uint8Array): boolean => bytes[0] === 0xff && bytes[1] === 0xd8;

/**
 * The index for the sheets ffmpeg wrote. Every sheet but the last is full;
 * the last holds what is left of the video's seconds, which is known from
 * the length ffmpeg printed and can never be more than a sheet holds.
 */
function indexOf(
  videoId: string,
  files: readonly string[],
  durationSeconds: number | null,
  cutAt: Date,
): FrameSheetIndex {
  const full = (files.length - 1) * FRAMES_PER_SHEET;
  const expected =
    durationSeconds === null
      ? files.length * FRAMES_PER_SHEET
      : Math.round(durationSeconds / FRAME_EVERY_SECONDS);
  const frameCount = Math.min(files.length * FRAMES_PER_SHEET, Math.max(full + 1, expected));
  return {
    videoId,
    cutAt: cutAt.toISOString(),
    everySeconds: FRAME_EVERY_SECONDS,
    columns: SHEET_COLUMNS,
    rows: SHEET_ROWS,
    frameWidth: SHEET_FRAME_WIDTH,
    frameHeight: SHEET_FRAME_HEIGHT,
    frameCount,
    sheets: files.map((file, index) => {
      const frames = Math.min(FRAMES_PER_SHEET, frameCount - index * FRAMES_PER_SHEET);
      const firstSecond = index * FRAMES_PER_SHEET * FRAME_EVERY_SECONDS;
      return {
        index,
        file,
        frames,
        firstSecond,
        lastSecond: firstSecond + (frames - 1) * FRAME_EVERY_SECONDS,
      };
    }),
  };
}

/** The sheets in the folder, in order, once each is known to be a picture; else why not. */
async function writtenSheets(folder: string): Promise<readonly string[] | string> {
  const files = (await readdir(folder)).filter((name) => SHEET_NAME.test(name)).sort();
  if (files.length === 0) return 'ffmpeg wrote no frames';
  for (const file of files) {
    const bytes = await readFile(pathInside(folder, file));
    if (!isJpeg(bytes)) return 'ffmpeg wrote a sheet that is not a JPEG picture';
  }
  return files;
}

/** Removes one video's sheets. Harmless when there are none. */
export async function removeFrameSheets(root: string, videoId: string): Promise<void> {
  await rm(frameSheetFolder(root, videoId), { recursive: true, force: true });
}

/**
 * Cuts one video file into sheets of frames, one frame a second, under the
 * temporary folder, and writes an index beside them saying which seconds each
 * sheet shows. Whatever goes wrong, no half-made folder is left behind. The
 * caller removes the sheets after use with `removeFrameSheets`; sheets left
 * over are cleared with the old video copies after a day.
 */
export async function cutFrameSheets(
  video: { readonly videoId: string; readonly path: string },
  options: CutOptions,
): Promise<FrameSheetCut> {
  const folder = frameSheetFolder(options.root, video.videoId);
  const source = pathInsideAny(
    [videoTempFolder(options.root), ...(options.alsoFrom ?? [])],
    video.path,
  );
  const program = await findFfmpeg(options.env, options.platform);
  if (program === null) return { ok: false, reason: 'ffmpeg is not installed on this computer' };
  await removeFrameSheets(options.root, video.videoId);
  await mkdir(folder, { recursive: true });
  const fail = async (reason: string): Promise<FrameSheetCut> => {
    await removeFrameSheets(options.root, video.videoId);
    return { ok: false, reason };
  };
  const run = options.run ?? programRunner(CUT_TIMEOUT_MS);
  const result = await run(program, ffmpegArguments(source, folder), options.signal);
  if (options.signal?.aborted) return fail('the cutting was stopped because Jgtube is closing');
  if (result.code === null) return fail('ffmpeg took too long and was stopped');
  if (result.code !== 0) return fail('ffmpeg ended with an error');
  const files = await writtenSheets(folder);
  if (typeof files === 'string') return fail(files);
  const index = indexOf(
    video.videoId,
    files,
    durationFrom(result.stderr),
    (options.now ?? (() => new Date()))(),
  );
  await writeFile(
    pathInside(folder, FRAME_SHEET_INDEX_FILE),
    `${JSON.stringify(index, null, JSON_INDENT)}\n`,
    'utf8',
  );
  return { ok: true, folder, sheetCount: index.sheets.length, frameCount: index.frameCount };
}

/** The index of one video's sheets, checked again as read; null when there is none to trust. */
async function readIndex(folder: string): Promise<FrameSheetIndex | null> {
  try {
    const text = await readFile(pathInside(folder, FRAME_SHEET_INDEX_FILE), 'utf8');
    const parsed = indexSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readSheet(folder: string, file: string): Promise<FetchedImage> {
  try {
    const path = pathInside(folder, file);
    if ((await stat(path)).size > MAX_SHEET_BYTES) {
      return { ok: false, reason: 'the sheet is larger than a sheet should be' };
    }
    const bytes = new Uint8Array(await readFile(path));
    return isJpeg(bytes)
      ? { ok: true, bytes, mimeType: 'image/jpeg' }
      : { ok: false, reason: 'the sheet is not a picture' };
  } catch {
    return { ok: false, reason: 'the sheet is no longer there' };
  }
}

const asFrameSheet = (sheet: CutSheet, index: FrameSheetIndex): Omit<FrameSheet, 'url'> => ({
  index: sheet.index,
  columns: index.columns,
  rows: index.rows,
  frames: sheet.frames,
  intervalMs: index.everySeconds * SECOND_MS,
  firstFrameMs: sheet.firstSecond * SECOND_MS,
  lastFrameMs: sheet.lastSecond * SECOND_MS,
});

/**
 * Up to `wanted` of the sheets cut from one video's file: in a row from sheet
 * `from` (numbered from 0), or spread across the video when `from` is left
 * out. Null when no sheets were cut for the video, so the caller can fall
 * back to YouTube's preview frames. The sheets are found by video id and
 * sheet number alone, inside the folder this module made.
 */
export async function readFileFrames(
  root: string,
  videoId: string,
  wanted: number,
  from?: number,
): Promise<VideoFrames | null> {
  const folder = frameSheetFolder(root, videoId);
  const index = await readIndex(folder);
  if (index === null || index.videoId !== videoId) return null;
  const count = index.sheets.length;
  const numbers =
    from === undefined
      ? spreadSheetNumbers(count, wanted)
      : Array.from(
          { length: Math.max(0, Math.min(wanted, count - Math.max(0, from))) },
          (_, offset) => Math.max(0, from) + offset,
        );
  const chosen = numbers.flatMap((number) => index.sheets[number] ?? []);
  const images = await Promise.all(chosen.map((sheet) => readSheet(folder, sheet.file)));
  return {
    videoId,
    source: 'file',
    sheetCount: count,
    frameCount: index.frameCount,
    frameWidth: index.frameWidth,
    frameHeight: index.frameHeight,
    sheets: chosen.flatMap((sheet, position) => {
      const image = images[position];
      const described = asFrameSheet(sheet, index);
      return image ? [{ sheet: described, caption: describeSheet(described, count), image }] : [];
    }),
  };
}

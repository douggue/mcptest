import { readFile, readdir } from 'node:fs/promises';
import { pathInside } from '../downloads/folder';
import { findProgram, programRunner, type RunProgram } from '../downloads/program';
import { VIDEO_ID_PATTERN } from '../sources/parse';
import { CHAPTER_COLUMNS, CHAPTER_ROWS, MAX_CHAPTERS, MEASURE_TIMEOUT_MS } from './constants';
import { spanSheetArgs } from './ffmpegArgs';
import type { Span } from './parse';

/**
 * Where one video's teardown pictures are kept, and the pictures made after
 * the chapters are known. Pictures are found by video id and a fixed file
 * name pattern only: no path from outside ever reaches the disk.
 */

export const TEARDOWNS_FOLDER = 'teardowns';
/** The only file names a teardown folder holds. */
export const TEARDOWN_IMAGE_NAME = /^(?:k-\d{3}|s-\d{3}|hook|chapter-\d{2})\.jpg$/;
const MAX_IMAGE_BYTES = 4_000_000;

export function teardownFolder(root: string, videoId: string): string {
  if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error('Not a valid video id');
  return pathInside(root, TEARDOWNS_FOLDER, videoId);
}

export const chapterSheetFile = (index: number): string =>
  `chapter-${String(index).padStart(2, '0')}.jpg`;

/** One sheet per chapter (up to the cap), each frames spread evenly across it; the files made, by chapter number. */
export async function cutChapterSheets(
  path: string,
  folder: string,
  spans: readonly Span[],
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly run?: RunProgram;
    readonly signal?: AbortSignal;
  } = {},
): Promise<Readonly<Record<string, string>>> {
  const ffmpeg = await findProgram('ffmpeg', options.env);
  if (ffmpeg === null) return {};
  const run = options.run ?? programRunner(MEASURE_TIMEOUT_MS);
  const made: Record<string, string> = {};
  for (const [index, span] of spans.slice(0, MAX_CHAPTERS).entries()) {
    const file = chapterSheetFile(index + 1);
    const result = await run(
      ffmpeg,
      spanSheetArgs(path, span, CHAPTER_COLUMNS, CHAPTER_ROWS, pathInside(folder, file)),
      options.signal,
    );
    if (options.signal?.aborted) break;
    if (result.code === 0) made[String(index + 1)] = file;
  }
  return made;
}

/** One picture of a video's teardown, by its name; null when the name is not one of ours or the file is gone. */
export async function readTeardownImage(
  root: string,
  videoId: string,
  name: string,
): Promise<Uint8Array | null> {
  if (!TEARDOWN_IMAGE_NAME.test(name)) return null;
  try {
    const bytes = await readFile(pathInside(teardownFolder(root, videoId), name));
    return bytes.length > MAX_IMAGE_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8
      ? null
      : new Uint8Array(bytes);
  } catch {
    return null;
  }
}

/** The pictures a teardown folder holds, sorted. */
export async function teardownImages(root: string, videoId: string): Promise<readonly string[]> {
  const names = await readdir(teardownFolder(root, videoId)).catch(() => [] as string[]);
  return names.filter((name) => TEARDOWN_IMAGE_NAME.test(name)).sort();
}

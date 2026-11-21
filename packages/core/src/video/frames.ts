import {
  STORYBOARD_RULE,
  fetchPinnedImage,
  type FetchImage,
  type FetchedImage,
} from '../sources/images';
import { readStoryboard, type VideoPageDeps } from './pages';
import {
  chooseLevel,
  describeSheet,
  planSheetRun,
  planSheets,
  type FrameSheet,
} from './storyboard';

/**
 * Frames across a video, as whole storyboard sheets. Each sheet comes with a
 * caption saying how its grid is read and which moments it shows.
 */

export interface FrameDeps extends VideoPageDeps {
  /** Replaces the network for the sheet pictures; used by tests. */
  readonly fetchImage?: FetchImage;
}

export interface FrameSheetImage {
  /** Which sheet it is and when its frames were taken. */
  readonly sheet: Omit<FrameSheet, 'url'>;
  /** How to read the sheet: its grid, and the times of its frames. */
  readonly caption: string;
  /** The picture, or why it could not be loaded. */
  readonly image: FetchedImage;
}

/**
 * Where frames came from. 'preview': YouTube's own storyboard, small frames
 * several seconds apart. 'file': cut from the video file itself, one a second.
 */
export type FrameSource = 'preview' | 'file';

export interface VideoFrames {
  readonly videoId: string;
  readonly source: FrameSource;
  /** Sheets the video has at the size used; `sheets` holds the ones asked for. */
  readonly sheetCount: number;
  /** Frames the video has at the size used, over all its sheets. */
  readonly frameCount: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly sheets: readonly FrameSheetImage[];
}

/** Which sheets to load: `wanted` spread across the video, or in a row from sheet `from` (from 0). */
interface Wanted {
  readonly wanted: number;
  readonly from: number | undefined;
}

async function loadSheets(
  deps: FrameDeps,
  videoId: string,
  { wanted, from }: Wanted,
  refresh: boolean,
): Promise<{ readonly frames: VideoFrames | null; readonly fromStore: boolean }> {
  const { levels, fromStore } = await readStoryboard(deps, videoId, { refresh });
  const level = chooseLevel(levels);
  if (level === null) return { frames: null, fromStore };
  const duration = deps.details.findDetails(videoId)?.durationSeconds ?? null;
  const plan =
    from === undefined
      ? planSheets(level, wanted, duration)
      : planSheetRun(level, from, wanted, duration);
  const images = await Promise.all(
    plan.map((sheet) => fetchPinnedImage(sheet.url, STORYBOARD_RULE, deps.fetchImage)),
  );
  const sheets = plan.flatMap((sheet, index): FrameSheetImage[] => {
    const image = images[index];
    return image ? [{ sheet, caption: describeSheet(sheet, level.sheetCount), image }] : [];
  });
  return {
    frames: {
      videoId,
      source: 'preview',
      sheetCount: level.sheetCount,
      frameCount: level.frameCount,
      frameWidth: level.frameWidth,
      frameHeight: level.frameHeight,
      sheets,
    },
    fromStore,
  };
}

/**
 * Up to `wanted` sheets of frames of one video, or null when the video has no
 * storyboard: spread across the video, or, with `from`, in a row starting at
 * that sheet (numbered from 0), so that every frame can be walked through a
 * few sheets at a time. Sheet addresses are signed and run out, so when every
 * sheet of a stored storyboard fails to load, the video's page is read again
 * once and the sheets are tried again.
 */
export async function readVideoFrames(
  deps: FrameDeps,
  videoId: string,
  wanted: number,
  from?: number,
): Promise<VideoFrames | null> {
  const which: Wanted = { wanted, from };
  const first = await loadSheets(deps, videoId, which, false);
  const allFailed =
    first.frames !== null &&
    first.frames.sheets.length > 0 &&
    first.frames.sheets.every((entry) => !entry.image.ok);
  if (!first.fromStore || !allFailed) return first.frames;
  return (await loadSheets(deps, videoId, which, true)).frames;
}

import {
  STORYBOARD_RULE,
  fetchPinnedImage,
  type FetchImage,
  type FetchedImage,
} from '../sources/images';
import { readStoryboard, type VideoPageDeps } from './pages';
import { chooseLevel, describeSheet, planSheets, type FrameSheet } from './storyboard';

/**
 * Frames across a video, as whole storyboard sheets. Each sheet comes with a
 * caption saying how its grid is read and which moments it shows.
 */

export interface FrameDeps extends VideoPageDeps {
  /** Replaces the network for the sheet pictures; used by tests. */
  readonly fetchImage?: FetchImage;
}

export interface FrameSheetImage {
  readonly sheet: FrameSheet;
  /** How to read the sheet: its grid, and the times of its frames. */
  readonly caption: string;
  /** The picture, or why it could not be loaded. */
  readonly image: FetchedImage;
}

export interface VideoFrames {
  readonly videoId: string;
  /** Sheets the video has at the size used; `sheets` holds the ones asked for. */
  readonly sheetCount: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly sheets: readonly FrameSheetImage[];
}

async function loadSheets(
  deps: FrameDeps,
  videoId: string,
  wanted: number,
  refresh: boolean,
): Promise<{ readonly frames: VideoFrames | null; readonly fromStore: boolean }> {
  const { levels, fromStore } = await readStoryboard(deps, videoId, { refresh });
  const level = chooseLevel(levels);
  if (level === null) return { frames: null, fromStore };
  const duration = deps.details.findDetails(videoId)?.durationSeconds ?? null;
  const plan = planSheets(level, wanted, duration);
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
      sheetCount: level.sheetCount,
      frameWidth: level.frameWidth,
      frameHeight: level.frameHeight,
      sheets,
    },
    fromStore,
  };
}

/**
 * Up to `wanted` sheets of frames spread across one video, or null when the
 * video has no storyboard. Sheet addresses are signed and run out, so when
 * every sheet of a stored storyboard fails to load, the video's page is read
 * again once and the sheets are tried again.
 */
export async function readVideoFrames(
  deps: FrameDeps,
  videoId: string,
  wanted: number,
): Promise<VideoFrames | null> {
  const first = await loadSheets(deps, videoId, wanted, false);
  const allFailed =
    first.frames !== null &&
    first.frames.sheets.length > 0 &&
    first.frames.sheets.every((entry) => !entry.image.ok);
  if (!first.fromStore || !allFailed) return first.frames;
  return (await loadSheets(deps, videoId, wanted, true)).frames;
}

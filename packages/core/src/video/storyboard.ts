import type { StoryboardLevel } from '../sources/types';
import { SHEET_SLOT } from '../sources/videoPage';
import { clock } from './transcriptText';

/**
 * Which sheets of a video's storyboard to look at, and what each one shows.
 *
 * A sheet is one picture holding a grid of small frames taken at a regular
 * interval. Whole sheets are handed over with a caption saying how to read
 * the grid, so no image-processing library is needed to cut them up.
 */

/**
 * The frame width aimed for. At 160 pixels a frame is large enough to tell a
 * talking head from a diagram from stock footage, and a sheet holds
 * twenty-five of them, so a few sheets cover a whole video. The next size up
 * shows more in each frame and needs nearly three times the sheets.
 */
export const STORYBOARD_FRAME_WIDTH = 160;

const SECOND_MS = 1000;

/** The size to use: the widest that is no wider than the width aimed for, else the narrowest. */
export function chooseLevel(levels: readonly StoryboardLevel[]): StoryboardLevel | null {
  const byWidth = [...levels].sort((a, b) => a.frameWidth - b.frameWidth);
  const fitting = byWidth.filter((level) => level.frameWidth <= STORYBOARD_FRAME_WIDTH);
  return fitting.at(-1) ?? byWidth[0] ?? null;
}

/** One sheet of frames: where it is and which moments of the video it shows. */
export interface FrameSheet {
  /** The sheet's number, from 0. */
  readonly index: number;
  readonly url: string;
  readonly columns: number;
  readonly rows: number;
  /** Frames on this sheet; the last sheet's grid may be partly empty. */
  readonly frames: number;
  /** Milliseconds between frames; null when it cannot be told. */
  readonly intervalMs: number | null;
  /** When the first and last frames on the sheet were taken; null when it cannot be told. */
  readonly firstFrameMs: number | null;
  readonly lastFrameMs: number | null;
}

/** Sheet numbers spread evenly over the video: both ends and the steps between, or the middle for one. */
function spread(sheetCount: number, wanted: number): readonly number[] {
  if (wanted >= sheetCount) return Array.from({ length: sheetCount }, (_, index) => index);
  if (wanted <= 1) return [Math.floor((sheetCount - 1) / 2)];
  const step = (sheetCount - 1) / (wanted - 1);
  return [...new Set(Array.from({ length: wanted }, (_, n) => Math.round(n * step)))];
}

/**
 * The interval between frames. A size that gives none spreads its frames
 * evenly, so the interval is the video's length over the number of frames.
 */
function intervalOf(level: StoryboardLevel, durationSeconds: number | null): number | null {
  if (level.intervalMs > 0) return level.intervalMs;
  if (durationSeconds === null || durationSeconds <= 0) return null;
  return Math.round((durationSeconds * SECOND_MS) / level.frameCount);
}

/**
 * Up to `wanted` sheets of one size, spread across the video, each with the
 * times of its frames. `durationSeconds` is only needed for a size that gives
 * no interval.
 */
export function planSheets(
  level: StoryboardLevel,
  wanted: number,
  durationSeconds: number | null = null,
): readonly FrameSheet[] {
  const perSheet = level.columns * level.rows;
  const intervalMs = intervalOf(level, durationSeconds);
  return spread(level.sheetCount, wanted).flatMap((index): FrameSheet[] => {
    const firstFrame = index * perSheet;
    const frames = Math.min(perSheet, level.frameCount - firstFrame);
    if (frames <= 0) return [];
    return [
      {
        index,
        url: level.templateUrl.replace(SHEET_SLOT, String(index)),
        columns: level.columns,
        rows: level.rows,
        frames,
        intervalMs,
        firstFrameMs: intervalMs === null ? null : firstFrame * intervalMs,
        lastFrameMs: intervalMs === null ? null : (firstFrame + frames - 1) * intervalMs,
      },
    ];
  });
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** How often frames were taken, in words. */
function everyText(intervalMs: number): string {
  const seconds = intervalMs / SECOND_MS;
  return Number.isInteger(seconds)
    ? `one every ${plural(seconds, 'second')}`
    : `one every ${seconds.toFixed(1)} seconds`;
}

/** What a sheet shows and how to read it, for whoever is looking at the picture. */
export function describeSheet(sheet: FrameSheet, sheetCount: number): string {
  const grid = `a grid ${sheet.columns} across and ${sheet.rows} down, in order left to right, then top to bottom`;
  const empty = sheet.columns * sheet.rows - sheet.frames;
  const count =
    empty > 0
      ? `${plural(sheet.frames, 'frame')} (the last ${plural(empty, 'place')} of the grid ${empty === 1 ? 'is' : 'are'} empty)`
      : plural(sheet.frames, 'frame');
  const times =
    sheet.intervalMs === null || sheet.firstFrameMs === null || sheet.lastFrameMs === null
      ? 'evenly spaced; their times are not known'
      : `${everyText(sheet.intervalMs)}, from ${clock(sheet.firstFrameMs)} to ${clock(sheet.lastFrameMs)}`;
  return `Sheet ${sheet.index + 1} of ${sheetCount}: ${grid}. ${count}, ${times}.`;
}

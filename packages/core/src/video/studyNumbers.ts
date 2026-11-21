import { FRAME_EVERY_SECONDS } from '../downloads/frameSheets';
import type { StudiedFrames } from '../repos/types';

/**
 * The numbers that can be worked out, in code, from a stored study of a
 * video's frames. A study is a model's words, but it is asked to end with two
 * counts on lines of a fixed form. From those, the frames there were and the
 * video's length, the seconds between picture changes follow by arithmetic,
 * so nobody has to trust a model's sums.
 */

/** The closing line that says how many frames were looked at out of how many there are. */
export const FRAMES_LOOKED_AT_LINE = 'FRAMES LOOKED AT';
/** The closing line that says at how many places a frame differs from the one before it. */
export const CHANGES_SEEN_LINE = 'PICTURE CHANGES SEEN';

const ONE_DECIMAL = 10;

export interface FrameStudyNumbers {
  /** Frames on the sheets the study was shown, as the study says; null when it does not say. */
  readonly framesLookedAt: number | null;
  /** Places where a frame differs from the one before it, as the study counted; null when it did not. */
  readonly changesSeen: number | null;
  /** Seconds from one frame to the next, worked out; null when it cannot be. */
  readonly secondsPerFrame: number | null;
  /**
   * Seconds between picture changes on average, worked out: the time the
   * frames looked at span, over the changes seen. A change quicker than the
   * gap between two frames cannot be seen, so the picture changes at least
   * this often. Null when the study gives no usable count.
   */
  readonly secondsPerChange: number | null;
}

const oneDecimal = (value: number): number => Math.round(value * ONE_DECIMAL) / ONE_DECIMAL;

/** The first whole number after the last line that opens with `label:`; null when there is none. */
function closingCount(text: string, label: string): number | null {
  const line = new RegExp(`^\\s*${label}:\\s*([\\d,]+)\\b`, 'gim');
  const last = [...text.matchAll(line)].at(-1);
  if (last?.[1] === undefined) return null;
  const count = Number(last[1].replaceAll(',', ''));
  return Number.isSafeInteger(count) ? count : null;
}

/** Seconds from one frame to the next: one for frames cut from the file, else the length shared out. */
function frameGap(frames: StudiedFrames | null, durationSeconds: number | null): number | null {
  if (frames === null) return null;
  if (frames.source === 'file') return FRAME_EVERY_SECONDS;
  if (durationSeconds === null || durationSeconds <= 0 || frames.available < 1) return null;
  return durationSeconds / frames.available;
}

/**
 * What a frame study's closing lines and the stored facts come to. `frames`
 * is where the frames came from and how many there were; `durationSeconds`
 * is the video's stored length.
 */
export function frameStudyNumbers(
  text: string,
  frames: StudiedFrames | null,
  durationSeconds: number | null,
): FrameStudyNumbers {
  const framesLookedAt = closingCount(text, FRAMES_LOOKED_AT_LINE);
  const changesSeen = closingCount(text, CHANGES_SEEN_LINE);
  const gap = frameGap(frames, durationSeconds);
  const countable =
    gap !== null &&
    framesLookedAt !== null &&
    changesSeen !== null &&
    changesSeen > 0 &&
    // There is one place a picture can change between each two frames, and no more.
    changesSeen < framesLookedAt;
  return {
    framesLookedAt,
    changesSeen,
    secondsPerFrame: gap === null ? null : oneDecimal(gap),
    secondsPerChange: countable ? oneDecimal((framesLookedAt * gap) / changesSeen) : null,
  };
}

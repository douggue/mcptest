import { MAX_KEYFRAMES } from './constants';
import type { Span } from './parse';

/**
 * Which frames stand for the video: one per shot, taken in the middle of the
 * shot. A video with more shots than `max` has its shots put into `max` runs
 * of neighbours, and each run is shown by the middle of its longest shot.
 * Each keyframe carries the seconds of video it stands for, which is what
 * its colours weigh in the palette.
 */

export interface PlannedKeyframe {
  readonly id: string;
  /** Seconds into the video. */
  readonly at: number;
  /** The shot it is taken from, counted from 0. */
  readonly shot: number;
  /** The seconds of video it stands for. */
  readonly covers: number;
}

const ID_DIGITS = 3;
export const keyframeId = (index: number): string =>
  `k-${String(index + 1).padStart(ID_DIGITS, '0')}`;
const round = (value: number): number => Math.round(value * 1000) / 1000;

export function planKeyframes(
  shots: readonly Span[],
  max = MAX_KEYFRAMES,
): readonly PlannedKeyframe[] {
  const runs = Math.min(max, shots.length);
  return Array.from({ length: runs }, (_, run) => {
    const first = Math.floor((run * shots.length) / runs);
    const last = Math.floor(((run + 1) * shots.length) / runs);
    const members = shots
      .slice(first, last)
      .map((span, offset) => ({ span, shot: first + offset }));
    const longest = members.reduce((best, member) =>
      member.span.end - member.span.start > best.span.end - best.span.start ? member : best,
    );
    return {
      id: keyframeId(run),
      at: round((longest.span.start + longest.span.end) / 2),
      shot: longest.shot,
      covers: round(members.reduce((sum, member) => sum + member.span.end - member.span.start, 0)),
    };
  });
}

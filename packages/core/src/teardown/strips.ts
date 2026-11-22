import { isAbsolute } from 'node:path';
import { HOOK_SECONDS, SHEET_TILE_HEIGHT, SHEET_TILE_WIDTH } from './constants';
import type { CameraKind, FrameRange, MotionFindings, TransitionKind } from './motionClassify';

/**
 * Short strips of frames at the video's own rate around each transition,
 * animation and camera move, so an engine can see how it is built frame by
 * frame. Chosen in code with caps: the opening first, then a few examples of
 * every kind spread across the video.
 */

/** Frames on one strip, and how they are laid out. */
export const STRIP_FRAMES = 10;
export const STRIP_COLUMNS = 5;
export const STRIP_ROWS = 2;
/** The most strips for one video, for the opening, and for one kind. */
export const MAX_STRIPS = 24;
export const OPENING_STRIPS = 6;
export const STRIPS_PER_KIND = 3;
/** A camera move is shown by this many seconds from the middle of its shot. */
const CAMERA_SECONDS = 2;

export type EventKind =
  Exclude<TransitionKind, 'cut'> | 'animation' | Exclude<CameraKind, 'static'>;

export interface MotionEvent extends FrameRange {
  readonly kind: EventKind;
}

export interface PlannedStrip extends MotionEvent {
  readonly id: string;
  /** The first frame shown, and every how many frames one is shown. */
  readonly fromFrame: number;
  readonly step: number;
}

const ID_DIGITS = 3;
export const stripId = (index: number): string => `s-${String(index + 1).padStart(ID_DIGITS, '0')}`;

/** Every event worth a strip: transitions other than plain cuts, animations, and camera moves. */
export function motionEvents(findings: MotionFindings, fps: number): readonly MotionEvent[] {
  const transitions = findings.transitions.flatMap((item): MotionEvent[] =>
    item.kind === 'cut' ? [] : [{ ...item, kind: item.kind }],
  );
  const animations = findings.animations.map((item): MotionEvent => ({
    ...item,
    kind: 'animation',
  }));
  const camera = findings.shots.flatMap((shot): MotionEvent[] => {
    if (shot.camera === 'static') return [];
    const middle = (shot.start + shot.end) / 2;
    const start = Math.max(shot.start, middle - CAMERA_SECONDS / 2);
    const end = Math.min(shot.end, middle + CAMERA_SECONDS / 2);
    const startFrame = Math.round(start * fps);
    const endFrame = Math.max(startFrame, Math.round(end * fps) - 1);
    return [
      { kind: shot.camera, start, end, startFrame, endFrame, frames: endFrame - startFrame + 1 },
    ];
  });
  return [...transitions, ...animations, ...camera].sort((a, b) => a.startFrame - b.startFrame);
}

/** Up to `count` items spread evenly through a list. */
const spreadOf = <T>(items: readonly T[], count: number): readonly T[] =>
  items.length <= count
    ? items
    : Array.from(
        { length: count },
        (_, index) => items[Math.floor((index * items.length) / count)] as T,
      );

/** Which events get a strip: the opening's first, then a few of every kind, the whole capped. */
export function planStrips(
  events: readonly MotionEvent[],
  max = MAX_STRIPS,
): readonly PlannedStrip[] {
  const opening = events.filter((event) => event.start < HOOK_SECONDS).slice(0, OPENING_STRIPS);
  const kinds = [...new Set(events.map((event) => event.kind))];
  const examples = kinds.flatMap((kind) =>
    spreadOf(
      events.filter((event) => event.kind === kind && !opening.includes(event)),
      STRIPS_PER_KIND,
    ),
  );
  const chosen = [...opening, ...examples]
    .slice(0, max)
    .sort((a, b) => a.startFrame - b.startFrame);
  return chosen.map((event, index) => {
    const step = Math.max(1, Math.ceil(event.frames / STRIP_FRAMES));
    const spare = Math.max(0, STRIP_FRAMES - event.frames);
    return {
      ...event,
      id: stripId(index),
      step,
      fromFrame: Math.max(0, event.startFrame - Math.floor(spare / 2)),
    };
  });
}

/** The ffmpeg arguments for one strip: `STRIP_FRAMES` frames, every `step`th from `fromFrame`. */
export function stripArgs(path: string, fromSeconds: number, step: number, out: string): string[] {
  if (!isAbsolute(path) || !isAbsolute(out)) throw new Error('ffmpeg is only given absolute paths');
  const filter = [
    `select='not(mod(n,${step}))'`,
    `scale=${SHEET_TILE_WIDTH}:${SHEET_TILE_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${SHEET_TILE_WIDTH}:${SHEET_TILE_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    `tile=${STRIP_COLUMNS}x${STRIP_ROWS}`,
  ].join(',');
  return [
    ...['-hide_banner', '-nostdin', '-nostats', '-y', '-ss', fromSeconds.toFixed(3), '-i', path],
    ...['-an', '-sn', '-vf', filter, '-frames:v', '1', '-q:v', '4', out],
  ];
}

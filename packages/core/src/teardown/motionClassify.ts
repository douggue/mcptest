import { ANALYSIS_HEIGHT, ANALYSIS_WIDTH, thumbDifference, type FrameSample } from './motionFrames';
import type { Span } from './parse';
import { median } from './shots';

/**
 * Transitions, holds, on-screen animation and camera motion, classified in
 * code from the per-frame samples of every frame. Every threshold is named
 * here; the method lines on the page quote them.
 */

/** A frame this much brighter than the one before, back within FLASH_MAX_FRAMES, is a flash. */
export const FLASH_JUMP = 40;
export const FLASH_MAX_FRAMES = 3;
/** Grey levels at or below / at or above which a frame is black / white. */
export const BLACK_LUMA = 20;
export const WHITE_LUMA = 235;
/** A fade ramps for at least this many frames into or out of black or white. */
export const FADE_MIN_FRAMES = 5;
/** Frames changing at least this much (% of full scale) for 2 to WHIP_MAX_FRAMES frames in a row: a whip-like move. */
export const WHIP_DIFF = 8;
export const WHIP_MAX_FRAMES = 10;
/** A dissolve: change this much above the local usual, for DISSOLVE_MIN_FRAMES to DISSOLVE_MAX_SECONDS... */
export const DISSOLVE_ABOVE_USUAL = 0.4;
export const DISSOLVE_MIN_FRAMES = 6;
export const DISSOLVE_MAX_SECONDS = 3;
/** ...whose first and last frames differ at least this much (%), and by at least this share of the summed change. */
export const DISSOLVE_END_CHANGE = 8;
export const DISSOLVE_STRAIGHTNESS = 0.6;
/** On-screen animation: change this much above the local usual, at least ANIMATION_MIN_FRAMES, the camera still. */
export const ANIMATION_ABOVE_USUAL = 0.08;
export const ANIMATION_MIN_FRAMES = 3;
export const MAX_ANIMATIONS = 300;
/** A hold: change under this (%) for at least HOLD_SECONDS. */
export const STILL_DIFF = 0.06;
export const HOLD_SECONDS = 1.5;
/** The usual change around a frame is the median over this many seconds either side. */
export const USUAL_WINDOW_SECONDS = 3;
/** Camera motion per shot: a zoom of this %/s, a pan or tilt of this % of the frame per s, a shake of this many pixels. */
export const ZOOM_RATE = 1;
export const PAN_RATE = 3;
export const SHAKE_PIXELS = 0.8;
/** The camera counts as still for an animation when it moves less than this (pixels a frame, zoom change a frame). */
const STILL_SHIFT = 0.25;
const STILL_ZOOM = 0.0015;
const MERGE_GAP_FRAMES = 3;

export const TRANSITION_KINDS = [
  'cut',
  'dissolve',
  'fade-black',
  'fade-white',
  'flash',
  'whip',
] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];
export const CAMERA_KINDS = [
  'static',
  'push-in',
  'pull-out',
  'pan-left',
  'pan-right',
  'tilt-up',
  'tilt-down',
  'shake',
] as const;
export type CameraKind = (typeof CAMERA_KINDS)[number];

export interface FrameRange {
  /** Seconds. */
  readonly start: number;
  readonly end: number;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly frames: number;
}
export interface Transition extends FrameRange {
  readonly kind: TransitionKind;
}
export interface Animation extends FrameRange {
  /** How much the picture differs from the start of the animation to its end (%). */
  readonly change: number;
}
export interface ShotMotion {
  readonly shot: number;
  readonly start: number;
  readonly end: number;
  readonly camera: CameraKind;
  /** % of the frame width / height a second; positive is right / down. */
  readonly panPerSecond: number;
  readonly tiltPerSecond: number;
  /** % larger a second; positive is a push in. */
  readonly zoomPerSecond: number;
  /** Mean change a frame (%): how busy the shot is. */
  readonly intensity: number;
}
export interface MotionFindings {
  readonly transitions: readonly Transition[];
  readonly holds: readonly FrameRange[];
  readonly animations: readonly Animation[];
  readonly shots: readonly ShotMotion[];
}

const round = (value: number, places = 2): number =>
  Math.round(value * 10 ** places) / 10 ** places;

function rangeOf(
  samples: readonly FrameSample[],
  first: number,
  last: number,
  fps: number,
): FrameRange {
  const start = samples[first]?.t ?? first / fps;
  return {
    start: round(start, 3),
    end: round((samples[last]?.t ?? last / fps) + 1 / fps, 3),
    startFrame: first,
    endFrame: last,
    frames: last - first + 1,
  };
}

/** Runs of consecutive frames for which `test` holds, as [first, last] pairs. */
function runs(count: number, test: (index: number) => boolean): [number, number][] {
  const found: [number, number][] = [];
  let open: number | null = null;
  for (let index = 0; index <= count; index += 1) {
    const inside = index < count && test(index);
    if (inside && open === null) open = index;
    if (!inside && open !== null) {
      found.push([open, index - 1]);
      open = null;
    }
  }
  return found;
}

/** The usual change around each frame: the median of its neighbours' changes. */
function usualChange(samples: readonly FrameSample[], fps: number): readonly number[] {
  const reach = Math.max(1, Math.round(USUAL_WINDOW_SECONDS * fps));
  const step = Math.max(1, Math.floor(reach / 10));
  return samples.map((_, index) => {
    const around: number[] = [];
    for (
      let other = Math.max(1, index - reach);
      other <= Math.min(samples.length - 1, index + reach);
      other += step
    ) {
      around.push(samples[other]?.diff ?? 0);
    }
    return median(around);
  });
}

function flashes(samples: readonly FrameSample[]): [number, number][] {
  const found: [number, number][] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1]?.luma ?? 0;
    if ((samples[index]?.luma ?? 0) - before < FLASH_JUMP) continue;
    for (
      let last = index;
      last < Math.min(samples.length - 1, index + FLASH_MAX_FRAMES);
      last += 1
    ) {
      if (Math.abs((samples[last + 1]?.luma ?? 0) - before) <= FLASH_JUMP / 2) {
        found.push([index, last]);
        index = last;
        break;
      }
    }
  }
  return found;
}

/** Fades into and out of black or white runs: the frames ramping towards the run, and away from it. */
function fades(
  samples: readonly FrameSample[],
): { kind: TransitionKind; range: [number, number] }[] {
  const found: { kind: TransitionKind; range: [number, number] }[] = [];
  const luma = (index: number): number => samples[index]?.luma ?? 0;
  for (const [kind, extreme, sign] of [
    ['fade-black', (index: number) => luma(index) <= BLACK_LUMA, 1],
    ['fade-white', (index: number) => luma(index) >= WHITE_LUMA, -1],
  ] as const) {
    for (const [first, last] of runs(samples.length, extreme)) {
      let from = first;
      while (from > 1 && sign * (luma(from - 1) - luma(from)) > 0) from -= 1;
      if (first - from >= FADE_MIN_FRAMES) found.push({ kind, range: [from, first] });
      let to = last;
      while (to < samples.length - 1 && sign * (luma(to + 1) - luma(to)) > 0) to += 1;
      if (to - last >= FADE_MIN_FRAMES) found.push({ kind, range: [last, to] });
    }
  }
  return found;
}

const stillCamera = (sample: FrameSample | undefined): boolean =>
  sample !== undefined &&
  Math.abs(sample.dx) < STILL_SHIFT &&
  Math.abs(sample.dy) < STILL_SHIFT &&
  Math.abs(sample.zoom - 1) < STILL_ZOOM;

function cameraOf(pan: number, tilt: number, zoom: number, shake: number): CameraKind {
  const scores: [CameraKind, number][] = [
    [zoom > 0 ? 'push-in' : 'pull-out', Math.abs(zoom) / ZOOM_RATE],
    [pan > 0 ? 'pan-right' : 'pan-left', Math.abs(pan) / PAN_RATE],
    [tilt > 0 ? 'tilt-down' : 'tilt-up', Math.abs(tilt) / PAN_RATE],
    ['shake', shake / SHAKE_PIXELS],
  ];
  const [kind, score] = scores.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  return score >= 1 ? kind : 'static';
}

/** The mean with the lowest and highest tenth left out: steady against stray frames. */
function trimmedMean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length / 10);
  const kept = sorted.slice(cut, sorted.length - cut);
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
}

const deviation = (values: readonly number[]): number => {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length),
  );
};

/** The camera over one shot: trimmed mean motion of its frames (the first is the cut and is left out). */
function shotMotion(
  samples: readonly FrameSample[],
  shot: number,
  span: Span,
  fps: number,
  skip: ReadonlySet<number>,
): ShotMotion {
  const inside = samples.filter(
    (sample, index) => sample.t > span.start && sample.t < span.end && !skip.has(index),
  );
  // Content moving left means the camera turns right, so the signs flip.
  const pan = -trimmedMean(inside.map((sample) => sample.dx)) * fps * (100 / ANALYSIS_WIDTH);
  const tilt = -trimmedMean(inside.map((sample) => sample.dy)) * fps * (100 / ANALYSIS_HEIGHT);
  const zoom = (trimmedMean(inside.map((sample) => sample.zoom)) - 1) * fps * 100;
  const shake =
    inside.length < 2
      ? 0
      : (deviation(inside.map((s) => s.dx)) + deviation(inside.map((s) => s.dy))) / 2;
  const settled =
    inside.length < 2 ? { pan: 0, tilt: 0, zoom: 0, shake: 0 } : { pan, tilt, zoom, shake };
  return {
    shot,
    start: round(span.start),
    end: round(span.end),
    camera: cameraOf(settled.pan, settled.tilt, settled.zoom, settled.shake),
    panPerSecond: round(settled.pan + 0),
    tiltPerSecond: round(settled.tilt + 0),
    zoomPerSecond: round(settled.zoom + 0),
    intensity: round(
      inside.reduce((sum, sample) => sum + sample.diff, 0) / Math.max(1, inside.length),
    ),
  };
}

function mergeRuns(found: readonly [number, number][]): [number, number][] {
  return found.reduce<[number, number][]>((merged, [first, last]) => {
    const previous = merged.at(-1);
    if (previous && first - previous[1] <= MERGE_GAP_FRAMES)
      return [...merged.slice(0, -1), [previous[0], last]];
    return [...merged, [first, last]];
  }, []);
}

export interface ClassifyInput {
  readonly samples: readonly FrameSample[];
  readonly thumbs: readonly Uint8Array[];
  readonly fps: number;
  /** The hard cuts found by the scene pass, in seconds. */
  readonly cuts: readonly number[];
  /** The shots between those cuts. */
  readonly shots: readonly Span[];
}

/** Every transition, hold, animation and camera move in the video. */
export function classifyMotion(input: ClassifyInput): MotionFindings {
  const { samples, thumbs, fps } = input;
  const taken = new Set<number>();
  const claim = ([first, last]: [number, number]): void => {
    for (let index = first; index <= last; index += 1) taken.add(index);
  };
  const free = ([first, last]: [number, number]): boolean => {
    for (let index = first; index <= last; index += 1) if (taken.has(index)) return false;
    return true;
  };
  const transitions: Transition[] = [];
  const add = (kind: TransitionKind, range: [number, number]): void => {
    claim(range);
    transitions.push({ kind, ...rangeOf(samples, range[0], range[1], fps) });
  };
  flashes(samples).forEach((range) => add('flash', range));
  fades(samples)
    .filter((fade) => free(fade.range))
    .forEach((fade) => add(fade.kind, fade.range));
  runs(samples.length, (index) => (samples[index]?.diff ?? 0) >= WHIP_DIFF)
    .filter(
      ([first, last]) => last > first && last - first < WHIP_MAX_FRAMES && free([first, last]),
    )
    .forEach((range) => add('whip', range));
  // A cut the scene pass found at the edge of a flash or a fade belongs to it.
  for (const cut of input.cuts) {
    const frame = Math.min(samples.length - 1, Math.round(cut * fps));
    if (!taken.has(frame) && !taken.has(frame - 1)) add('cut', [frame, frame]);
  }
  const usual = usualChange(samples, fps);
  const above = (index: number, by: number): boolean =>
    !taken.has(index) && (samples[index]?.diff ?? 0) >= (usual[index] ?? 0) + by;
  const maxDissolve = Math.round(DISSOLVE_MAX_SECONDS * fps);
  for (const [first, last] of runs(samples.length, (index) => above(index, DISSOLVE_ABOVE_USUAL))) {
    const length = last - first + 1;
    if (length < DISSOLVE_MIN_FRAMES || length > maxDissolve) continue;
    const summed = samples.slice(first, last + 1).reduce((sum, sample) => sum + sample.diff, 0);
    const ends = thumbDifference(
      thumbs[first - 1] ?? thumbs[first] ?? new Uint8Array(),
      thumbs[last] ?? new Uint8Array(),
    );
    if (ends >= DISSOLVE_END_CHANGE && ends >= DISSOLVE_STRAIGHTNESS * summed)
      add('dissolve', [first, last]);
  }
  const animations = mergeRuns(
    runs(
      samples.length,
      (index) => above(index, ANIMATION_ABOVE_USUAL) && stillCamera(samples[index]),
    ),
  )
    .filter(([first, last]) => last - first + 1 >= ANIMATION_MIN_FRAMES)
    .slice(0, MAX_ANIMATIONS)
    .map(([first, last]): Animation => ({
      ...rangeOf(samples, first, last, fps),
      change: thumbDifference(
        thumbs[Math.max(0, first - 1)] ?? new Uint8Array(),
        thumbs[last] ?? new Uint8Array(),
      ),
    }));
  const holdFrames = Math.round(HOLD_SECONDS * fps);
  const holds = runs(
    samples.length,
    (index) => index > 0 && (samples[index]?.diff ?? 0) < STILL_DIFF,
  )
    .filter(([first, last]) => last - first + 1 >= holdFrames)
    .map(([first, last]) => rangeOf(samples, first, last, fps));
  return {
    transitions: transitions.sort((a, b) => a.startFrame - b.startFrame),
    holds,
    animations,
    shots: input.shots.map((span, shot) => shotMotion(samples, shot, span, fps, taken)),
  };
}

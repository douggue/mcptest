/**
 * What changes from one frame to the next, worked out in code on small grey
 * copies of every frame: how much the picture changed, how bright it is, and
 * how the whole picture moved (shift across and down, and zoom), found by
 * matching the column and row brightness profiles of the two frames
 * ("integral projections"). Cheap enough to run on every frame of a video.
 */

/** The size every frame is shrunk to before it is compared. */
export const ANALYSIS_WIDTH = 160;
export const ANALYSIS_HEIGHT = 90;
/** The tiny copy kept of every frame, to compare frames far apart afterwards. */
export const THUMB_WIDTH = 32;
export const THUMB_HEIGHT = 18;
/** The largest shift looked for between two frames, in analysis pixels. */
export const MAX_SHIFT = 16;
/** The zooms looked for between two frames: 1 ± this, in steps. */
const ZOOM_RANGE = 0.04;
const ZOOM_STEP = 0.002;

export interface FrameSample {
  /** Seconds into the video. */
  readonly t: number;
  /** Mean absolute grey difference from the frame before, as a percentage of full scale. */
  readonly diff: number;
  /** Mean grey level, 0 to 255. */
  readonly luma: number;
  /** How far the picture's content moved across and down since the frame before, in analysis pixels. */
  readonly dx: number;
  readonly dy: number;
  /** How much larger the content is than in the frame before (1 = same size). */
  readonly zoom: number;
}

const FULL_SCALE = 255;
const PERCENT = 100;

/** Mean grey of each column and each row, each profile with its own mean taken away. */
export function profiles(frame: Uint8Array, width: number, height: number) {
  const columns = new Float64Array(width);
  const rows = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = frame[y * width + x] ?? 0;
      columns[x] = (columns[x] ?? 0) + value / height;
      rows[y] = (rows[y] ?? 0) + value / width;
    }
  }
  return { columns: centred(columns), rows: centred(rows) };
}

function centred(profile: Float64Array): Float64Array {
  const mean = profile.reduce((sum, value) => sum + value, 0) / profile.length;
  return profile.map((value) => value - mean);
}

/** Linear interpolation inside a profile; null outside it. */
function sample(profile: Float64Array, at: number): number | null {
  if (at < 0 || at > profile.length - 1) return null;
  const low = Math.floor(at);
  const high = Math.min(profile.length - 1, low + 1);
  const part = at - low;
  return (profile[low] ?? 0) * (1 - part) + (profile[high] ?? 0) * part;
}

/** Mean absolute difference between `current` and `previous` moved by `shift` and grown by `zoom`. */
function mismatch(
  current: Float64Array,
  previous: Float64Array,
  shift: number,
  zoom: number,
): number {
  const centre = (current.length - 1) / 2;
  let total = 0;
  let count = 0;
  for (let x = 0; x < current.length; x += 1) {
    const from = sample(previous, centre + (x - shift - centre) / zoom);
    if (from === null) continue;
    total += Math.abs((current[x] ?? 0) - from);
    count += 1;
  }
  // Too little overlap says nothing about the match.
  return count < current.length / 2 ? Infinity : total / count;
}

/** The best value on a grid, refined between its neighbours by fitting a parabola. */
function refine(values: readonly number[], errors: readonly number[], best: number): number {
  const left = errors[best - 1];
  const right = errors[best + 1];
  const middle = errors[best] ?? 0;
  const value = values[best] ?? 0;
  if (left === undefined || right === undefined || !Number.isFinite(left + right)) return value;
  const curve = left - 2 * middle + right;
  if (curve <= 0) return value;
  const step = (values[best + 1] ?? value) - value;
  return value + (step * (left - right)) / (2 * curve);
}

function bestOf(values: readonly number[], error: (value: number) => number): number {
  const errors = values.map(error);
  const best = errors.reduce(
    (at, value, index) => (value < (errors[at] ?? Infinity) ? index : at),
    0,
  );
  return refine(values, errors, best);
}

const SHIFTS = Array.from({ length: 2 * MAX_SHIFT + 1 }, (_, index) => index - MAX_SHIFT);
const ZOOMS = Array.from(
  { length: Math.round((2 * ZOOM_RANGE) / ZOOM_STEP) + 1 },
  (_, index) => 1 - ZOOM_RANGE + index * ZOOM_STEP,
);

/** A profile flatter than this (grey levels) has nothing to follow: a plain or black frame. */
const MIN_TEXTURE = 1;
const spread = (profile: Float64Array): number =>
  Math.sqrt(profile.reduce((sum, value) => sum + value * value, 0) / profile.length);

/** The shift and zoom that best carry one profile onto the next; none for a plain frame. */
export function profileMotion(current: Float64Array, previous: Float64Array) {
  if (spread(current) < MIN_TEXTURE || spread(previous) < MIN_TEXTURE) return { shift: 0, zoom: 1 };
  const shift = bestOf(SHIFTS, (value) => mismatch(current, previous, value, 1));
  const zoom = bestOf(ZOOMS, (value) => mismatch(current, previous, shift, value));
  return { shift, zoom };
}

const round = (value: number, places: number): number =>
  Math.round(value * 10 ** places) / 10 ** places;

/** One frame compared with the one before it. */
export function compareFrames(
  previous: Uint8Array | null,
  current: Uint8Array,
  t: number,
  width = ANALYSIS_WIDTH,
  height = ANALYSIS_HEIGHT,
): FrameSample {
  let lumaTotal = 0;
  let diffTotal = 0;
  for (let index = 0; index < current.length; index += 1) {
    const value = current[index] ?? 0;
    lumaTotal += value;
    if (previous) diffTotal += Math.abs(value - (previous[index] ?? 0));
  }
  const luma = round(lumaTotal / current.length, 1);
  if (previous === null) return { t, diff: 0, luma, dx: 0, dy: 0, zoom: 1 };
  const now = profiles(current, width, height);
  const before = profiles(previous, width, height);
  const across = profileMotion(now.columns, before.columns);
  const down = profileMotion(now.rows, before.rows);
  return {
    t,
    diff: round((diffTotal / current.length / FULL_SCALE) * PERCENT, 2),
    luma,
    dx: round(across.shift, 2),
    dy: round(down.shift, 2),
    zoom: round((across.zoom + down.zoom) / 2, 4),
  };
}

/** A tiny copy of a frame, each pixel the mean of the block it covers. */
export function thumbnail(
  frame: Uint8Array,
  width = ANALYSIS_WIDTH,
  height = ANALYSIS_HEIGHT,
): Uint8Array {
  const blockX = width / THUMB_WIDTH;
  const blockY = height / THUMB_HEIGHT;
  const out = new Uint8Array(THUMB_WIDTH * THUMB_HEIGHT);
  for (let ty = 0; ty < THUMB_HEIGHT; ty += 1) {
    for (let tx = 0; tx < THUMB_WIDTH; tx += 1) {
      let total = 0;
      let count = 0;
      for (let y = Math.floor(ty * blockY); y < Math.floor((ty + 1) * blockY); y += 1) {
        for (let x = Math.floor(tx * blockX); x < Math.floor((tx + 1) * blockX); x += 1) {
          total += frame[y * width + x] ?? 0;
          count += 1;
        }
      }
      out[ty * THUMB_WIDTH + tx] = count === 0 ? 0 : Math.round(total / count);
    }
  }
  return out;
}

/** Mean absolute difference between two tiny copies, as a percentage of full scale. */
export function thumbDifference(a: Uint8Array, b: Uint8Array): number {
  let total = 0;
  for (let index = 0; index < a.length; index += 1)
    total += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  return round((total / Math.max(1, a.length) / FULL_SCALE) * PERCENT, 2);
}

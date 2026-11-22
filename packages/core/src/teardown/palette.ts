import { PALETTE_GROUPS, PALETTE_MIN_SHARE } from './constants';

/**
 * The dominant colours of a video, counted in code: every keyframe is shrunk
 * to a few hundred pixels, each pixel weighs as much as the share of the
 * runtime its shot lasts, and the pixels are grouped by k-means into a few
 * colours. Each colour comes out as a hex value with its share of the runtime.
 * The start is fixed (farthest-point), so the same frames always give the
 * same palette.
 */

export interface PaletteColour {
  readonly hex: string;
  /** Share of the runtime, 0 to 1. */
  readonly share: number;
}

/** The raw RGB bytes of one shrunk keyframe and the share of the runtime it stands for. */
export interface WeightedPixels {
  readonly rgb: Uint8Array;
  readonly weight: number;
}

type Rgb = readonly [number, number, number];

const ITERATIONS = 12;
const CHANNELS = 3;
const SHARE_PLACES = 3;

const distance = (a: Rgb, b: Rgb): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export const hexOf = (colour: Rgb): string =>
  `#${colour
    .map((value) =>
      Math.round(Math.min(255, Math.max(0, value)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;

interface Point {
  readonly rgb: Rgb;
  readonly weight: number;
}

function pointsOf(frames: readonly WeightedPixels[]): readonly Point[] {
  return frames.flatMap((frame) => {
    const count = Math.floor(frame.rgb.length / CHANNELS);
    if (count === 0) return [];
    const weight = frame.weight / count;
    return Array.from({ length: count }, (_, index): Point => {
      const at = index * CHANNELS;
      return { rgb: [frame.rgb[at] ?? 0, frame.rgb[at + 1] ?? 0, frame.rgb[at + 2] ?? 0], weight };
    });
  });
}

/** The first centre is the heaviest colour, each next one the colour farthest from those chosen. */
function startCentres(points: readonly Point[], groups: number): Rgb[] {
  const first = points.reduce((best, point) => (point.weight > best.weight ? point : best));
  const centres: Rgb[] = [first.rgb];
  while (centres.length < groups) {
    let far: Point | null = null;
    let farDistance = 0;
    for (const point of points) {
      const nearest = Math.min(...centres.map((centre) => distance(point.rgb, centre)));
      if (nearest > farDistance) {
        far = point;
        farDistance = nearest;
      }
    }
    if (far === null) break;
    centres.push(far.rgb);
  }
  return centres;
}

const nearestOf = (rgb: Rgb, centres: readonly Rgb[]): number =>
  centres.reduce(
    (best, centre, index) =>
      distance(rgb, centre) < distance(rgb, centres[best] ?? centre) ? index : best,
    0,
  );

function regroup(points: readonly Point[], centres: readonly Rgb[]) {
  const sums = centres.map(() => ({ r: 0, g: 0, b: 0, weight: 0 }));
  for (const point of points) {
    const sum = sums[nearestOf(point.rgb, centres)];
    if (!sum) continue;
    sum.r += point.rgb[0] * point.weight;
    sum.g += point.rgb[1] * point.weight;
    sum.b += point.rgb[2] * point.weight;
    sum.weight += point.weight;
  }
  return sums.map((sum, index) => ({
    centre: (sum.weight === 0
      ? centres[index]
      : [sum.r / sum.weight, sum.g / sum.weight, sum.b / sum.weight]) as Rgb,
    weight: sum.weight,
  }));
}

/** The dominant colours, the largest share first; colours under the minimum share are left out. */
export function dominantColours(
  frames: readonly WeightedPixels[],
  groups = PALETTE_GROUPS,
  minShare = PALETTE_MIN_SHARE,
): readonly PaletteColour[] {
  const points = pointsOf(frames);
  const total = points.reduce((sum, point) => sum + point.weight, 0);
  if (points.length === 0 || total <= 0) return [];
  let centres = startCentres(points, groups);
  let grouped = regroup(points, centres);
  for (let round = 1; round < ITERATIONS; round += 1) {
    centres = grouped.map((group) => group.centre);
    grouped = regroup(points, centres);
  }
  const merged = new Map<string, number>();
  for (const group of grouped) {
    const hex = hexOf(group.centre);
    merged.set(hex, (merged.get(hex) ?? 0) + group.weight / total);
  }
  return [...merged]
    .map(([hex, share]) => ({ hex, share: Number(share.toFixed(SHARE_PLACES)) }))
    .filter((colour) => colour.share >= minShare)
    .sort((a, b) => b.share - a.share);
}

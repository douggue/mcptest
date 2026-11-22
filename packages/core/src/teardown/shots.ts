import type { Span } from './parse';

/**
 * Shot pacing worked out from the cut times: how long each shot lasts, the
 * median and the average, and how many cuts fall in each minute, over the
 * whole video or one span of it (a chapter).
 */

export interface ShotStats {
  readonly cutCount: number;
  readonly shotCount: number;
  readonly medianSeconds: number;
  readonly averageSeconds: number;
  readonly cutsPerMinute: number;
}

const MINUTE = 60;
const round = (value: number, places = 2): number =>
  Math.round(value * 10 ** places) / 10 ** places;

/** The middle value; the mean of the two middle ones for an even count. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Each shot as the span between two cuts, the first from 0 and the last to the end. */
export function shotSpans(cuts: readonly number[], durationSeconds: number): readonly Span[] {
  const inside = cuts.filter((cut) => cut > 0 && cut < durationSeconds);
  const edges = [0, ...inside, durationSeconds];
  return edges.slice(1).map((end, index) => ({ start: edges[index] ?? 0, end }));
}

/** The pacing within one span: the cuts inside it, and the parts of shots that fall in it. */
export function shotStats(cuts: readonly number[], span: Span): ShotStats {
  const length = Math.max(0, span.end - span.start);
  const inside = cuts.filter((cut) => cut > span.start && cut < span.end);
  const edges = [span.start, ...inside, span.end];
  const lengths = edges.slice(1).map((end, index) => end - (edges[index] ?? 0));
  return {
    cutCount: inside.length,
    shotCount: lengths.length,
    medianSeconds: round(median(lengths)),
    averageSeconds: round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length),
    cutsPerMinute: length === 0 ? 0 : round((inside.length / length) * MINUTE),
  };
}

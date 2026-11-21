/**
 * The middle of some numbers and the middle half of them: the median, and
 * the values a quarter and three quarters of the way up (linear between
 * neighbours), with how many numbers they rest on.
 */
export interface Spread {
  readonly count: number;
  readonly median: number | null;
  /** The 25th and 75th percentiles: half the values lie between them. */
  readonly lower: number | null;
  readonly upper: number | null;
}

function percentile(sorted: readonly number[], share: number): number | null {
  if (sorted.length === 0) return null;
  const position = share * (sorted.length - 1);
  const below = sorted[Math.floor(position)] ?? 0;
  const above = sorted[Math.ceil(position)] ?? below;
  return below + (above - below) * (position - Math.floor(position));
}

export function spreadOf(values: readonly number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: percentile(sorted, 0.5),
    lower: percentile(sorted, 0.25),
    upper: percentile(sorted, 0.75),
  };
}

/**
 * Whether written words lift from real ones. A hook of the library is a model
 * for a way of opening, never text to reuse, and a rule in a question is only
 * a request: this counts, in code, the longest run of words a written hook
 * shares with any hook of the library, so a lifted phrase is seen whatever
 * the engine was told.
 */

/**
 * A shared run of this many words or more is called a lift. Shorter runs are
 * the common stock of any language ("for the first time in"); six words in
 * the same order is a phrase somebody wrote.
 */
export const LIFT_MIN_WORDS = 6;

const wordsOf = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** The longest run of words two texts share, in the same order. */
export function longestSharedRun(a: string, b: string): readonly string[] {
  const left = wordsOf(a);
  const right = wordsOf(b);
  let best: { readonly end: number; readonly length: number } = { end: 0, length: 0 };
  let previous: readonly number[] = new Array<number>(right.length + 1).fill(0);
  for (const [i, word] of left.entries()) {
    const current = [0, ...right.map((other, j) => (other === word ? (previous[j] ?? 0) + 1 : 0))];
    const length = Math.max(...current);
    if (length > best.length) best = { end: i + 1, length };
    previous = current;
  }
  return left.slice(best.end - best.length, best.end);
}

export interface Lift {
  /** The video whose opening the words are shared with. */
  readonly videoId: string;
  /** The shared words, as a phrase. */
  readonly phrase: string;
  readonly words: number;
}

/**
 * The longest phrase a written text shares with any of the given openings,
 * when it is `LIFT_MIN_WORDS` words or more; null when nothing that long is
 * shared.
 */
export function liftedFrom(
  written: string,
  openings: readonly { readonly videoId: string; readonly text: string | null }[],
): Lift | null {
  const runs = openings.map((opening) => ({
    videoId: opening.videoId,
    run: longestSharedRun(written, opening.text ?? ''),
  }));
  const [longest] = [...runs].sort((a, b) => b.run.length - a.run.length);
  if (!longest || longest.run.length < LIFT_MIN_WORDS) return null;
  return { videoId: longest.videoId, phrase: longest.run.join(' '), words: longest.run.length };
}

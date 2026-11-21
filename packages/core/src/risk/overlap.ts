import { LIFT_MIN_WORDS, longestSharedRun, wordsOf } from '../hooks/lift';
import { spokenText } from '../script/measure';

/**
 * Sentences of a script that share a long run of words with a stored
 * competitor transcript: the hook library's own check (six words or more in
 * the same order, `LIFT_MIN_WORDS`), run over every sentence. Each
 * transcript's six-word runs are indexed first, so only a transcript that
 * shares one is compared in full.
 */

export interface StoredText {
  readonly videoId: string;
  readonly text: string;
}

export interface Overlap {
  /** o1, o2… in the order of the script, for an answer to point to. */
  readonly id: string;
  readonly sentence: string;
  readonly videoId: string;
  /** The longest run of words shared, as a phrase. */
  readonly phrase: string;
  readonly words: number;
}

/** The sentences of what is said: headings, picture cues and check markers left out. */
export function scriptSentences(script: string): readonly string[] {
  return (spokenText(script).match(/[^.!?\n]+[.!?]*/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => wordsOf(sentence).length > 0);
}

const runsOf = (words: readonly string[]): readonly string[] =>
  words.length < LIFT_MIN_WORDS
    ? []
    : Array.from({ length: words.length - LIFT_MIN_WORDS + 1 }, (_, at) =>
        words.slice(at, at + LIFT_MIN_WORDS).join(' '),
      );

/** Which transcripts hold each six-word run. */
function indexOf(texts: readonly StoredText[]): ReadonlyMap<string, ReadonlySet<number>> {
  const index = new Map<string, Set<number>>();
  texts.forEach((text, position) =>
    runsOf(wordsOf(text.text)).forEach((run) =>
      index.set(run, (index.get(run) ?? new Set<number>()).add(position)),
    ),
  );
  return index;
}

/** The longest run one sentence shares with the transcripts that share a six-word run with it. */
function longestFor(
  sentence: string,
  texts: readonly StoredText[],
  index: ReadonlyMap<string, ReadonlySet<number>>,
): { readonly videoId: string; readonly run: readonly string[] } | null {
  const candidates = new Set(
    runsOf(wordsOf(sentence)).flatMap((run) => [...(index.get(run) ?? [])]),
  );
  const runs = [...candidates].flatMap((position) => {
    const text = texts[position];
    return text ? [{ videoId: text.videoId, run: longestSharedRun(sentence, text.text) }] : [];
  });
  const [longest] = runs.sort((a, b) => b.run.length - a.run.length);
  return longest && longest.run.length >= LIFT_MIN_WORDS ? longest : null;
}

export function scriptOverlaps(script: string, texts: readonly StoredText[]): readonly Overlap[] {
  const index = indexOf(texts);
  const found = scriptSentences(script).flatMap((sentence) => {
    const longest = longestFor(sentence, texts, index);
    return longest
      ? [
          {
            sentence,
            videoId: longest.videoId,
            phrase: longest.run.join(' '),
            words: longest.run.length,
          },
        ]
      : [];
  });
  return found.map((overlap, position) => ({ id: `o${position + 1}`, ...overlap }));
}

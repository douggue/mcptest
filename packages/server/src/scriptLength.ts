/**
 * A length the owner types for a script, in minutes or in words: the
 * length to store, the words typed when it was words, or why it cannot be.
 * The two stay in step through the speaking rate (core's `script/length`).
 */
import {
  lengthProblem,
  secondsForWords,
  wordsForSeconds,
  type StoredScript,
  type TypedLength,
} from '@jgtube/core';
import type { LengthInput } from './scriptTypes';

const NO_RATE =
  'Set a speaking rate first: words become a length only through the words a minute of the voice.';

/** What a typed length stores: the seconds, and which field was typed with its words. */
export function typedLength(
  input: LengthInput,
  script: Pick<StoredScript, 'wordsPerMinute'> | null,
  shorts: boolean,
): { readonly seconds: number; readonly typed: TypedLength } | { readonly problem: string } {
  const rate = script?.wordsPerMinute ?? null;
  if (input.typed === 'minutes') {
    const problem = lengthProblem({ seconds: input.seconds, shorts });
    return problem
      ? { problem }
      : { seconds: input.seconds, typed: { typed: 'minutes', words: null } };
  }
  const seconds = rate === null ? null : secondsForWords(input.words, rate);
  if (seconds === null) return { problem: NO_RATE };
  const problem = lengthProblem({ seconds, words: input.words, shorts });
  return problem ? { problem } : { seconds, typed: { typed: 'words', words: input.words } };
}

/** The words a script is written to: the words typed, or the length at the rate. */
export function targetWordsOf(
  script: Pick<StoredScript, 'wordsPerMinute' | 'targetSeconds'> | null,
  typed: TypedLength | null,
): number | null {
  if (typed?.typed === 'words' && typed.words !== null) return typed.words;
  const rate = script?.wordsPerMinute ?? null;
  const seconds = script?.targetSeconds ?? null;
  return rate === null || seconds === null ? null : wordsForSeconds(seconds, rate);
}

/** When the rate changes and the owner typed words, the length follows so the words stay. */
export function lengthAfterRate(
  wordsPerMinute: number | null | undefined,
  typed: TypedLength | null,
): { readonly targetSeconds: number } | Record<string, never> {
  if (
    wordsPerMinute === undefined ||
    wordsPerMinute === null ||
    typed?.typed !== 'words' ||
    typed.words === null
  )
    return {};
  const seconds = secondsForWords(typed.words, wordsPerMinute);
  return seconds === null ? {} : { targetSeconds: seconds };
}

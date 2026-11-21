import { SHORTS_LIMIT_SECONDS } from './types';

/**
 * A script's length as the owner types it: minutes (12:30 allowed) or words,
 * kept in step through the speaking rate. Both conversions round to the
 * nearest whole word or second, halves up.
 */

export const MIN_TARGET_SECONDS = 20;
export const MAX_TARGET_SECONDS = 3 * 60 * 60;
export const MIN_TARGET_WORDS = 50;
export const MAX_TARGET_WORDS = 30_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_ONLY = /^\d{1,3}(?:\.\d{1,2})?$/;
const MINUTES_AND_SECONDS = /^(\d{1,3}):([0-5]\d)$/;

/** Seconds from "12", "12.5" or "12:30"; null for anything else. */
export function parseMinutes(text: string): number | null {
  const trimmed = text.trim();
  const clock = MINUTES_AND_SECONDS.exec(trimmed);
  if (clock) return Number(clock[1]) * SECONDS_PER_MINUTE + Number(clock[2]);
  return MINUTES_ONLY.test(trimmed) ? Math.round(Number(trimmed) * SECONDS_PER_MINUTE) : null;
}

/** The words that fill a length at a rate, to the nearest word. */
export const wordsForSeconds = (seconds: number, wordsPerMinute: number): number =>
  Math.round((seconds * wordsPerMinute) / SECONDS_PER_MINUTE);

/** The seconds a number of words takes at a rate, to the nearest second; null with no rate. */
export const secondsForWords = (words: number, wordsPerMinute: number): number | null =>
  wordsPerMinute > 0 ? Math.round((words * SECONDS_PER_MINUTE) / wordsPerMinute) : null;

/** Why a length cannot be used, in plain words; null when it can. */
export function lengthProblem(length: {
  readonly seconds: number;
  readonly words?: number;
  readonly shorts: boolean;
}): string | null {
  if (length.shorts && length.seconds > SHORTS_LIMIT_SECONDS) {
    return `A Short is under a minute: at most ${SHORTS_LIMIT_SECONDS} seconds.`;
  }
  if (length.words !== undefined && length.words < MIN_TARGET_WORDS) {
    return `A script has at least ${MIN_TARGET_WORDS} words.`;
  }
  if (length.words !== undefined && length.words > MAX_TARGET_WORDS) {
    return 'A script has at most 30,000 words.';
  }
  if (length.seconds < MIN_TARGET_SECONDS) {
    return `A script runs at least ${MIN_TARGET_SECONDS} seconds.`;
  }
  if (length.seconds > MAX_TARGET_SECONDS) return 'A script runs at most 3 hours.';
  return null;
}

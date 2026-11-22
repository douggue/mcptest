import { HAMMER_MAX_WORDS, HAMMER_MIN_WORDS, MAX_HAMMERS } from './constants';
import type { Span } from './parse';
import { median } from './shots';

/**
 * The spoken words counted in code: how many, how fast, how long the
 * sentences run, and the short "hammer" sentences of two to five words that
 * land a point. Read from timed lines (captions, or what an engine heard).
 */

export interface TimedLine {
  /** Seconds from the start of the video. */
  readonly at: number;
  readonly text: string;
}

export interface TimedSentence {
  readonly at: number;
  readonly text: string;
  readonly words: number;
}

export interface WordStats {
  readonly wordCount: number;
  readonly wordsPerMinute: number;
  readonly sentenceCount: number;
  readonly medianSentenceWords: number;
  readonly averageSentenceWords: number;
  readonly hammers: readonly TimedSentence[];
}

const MINUTE = 60;
const round = (value: number, places = 1): number =>
  Math.round(value * 10 ** places) / 10 ** places;
/** A caption line's markup and sound tags ("[Music]") are not words. */
const clean = (text: string): string =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const wordsIn = (text: string): number =>
  (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

/** The lines read as sentences, each timed by the line it starts in. */
export function sentencesOf(lines: readonly TimedLine[]): readonly TimedSentence[] {
  const sentences: TimedSentence[] = [];
  let open: { at: number; text: string } | null = null;
  for (const line of lines) {
    const pieces = clean(line.text).split(/(?<=[.!?…])\s+/);
    for (const piece of pieces) {
      if (piece === '') continue;
      const text: string = open === null ? piece : `${open.text} ${piece}`;
      const at: number = open?.at ?? line.at;
      if (/[.!?…]["”’)]?$/.test(piece)) {
        sentences.push({ at, text, words: wordsIn(text) });
        open = null;
      } else open = { at, text };
    }
  }
  if (open !== null) sentences.push({ at: open.at, text: open.text, words: wordsIn(open.text) });
  return sentences.filter((sentence) => sentence.words > 0);
}

/** The words of the lines that start inside a span, and how fast they come. */
export function wordStats(lines: readonly TimedLine[], span: Span): WordStats {
  const inside = lines.filter((line) => line.at >= span.start && line.at < span.end);
  const sentences = sentencesOf(inside);
  const counts = sentences.map((sentence) => sentence.words);
  const wordCount = inside.reduce((sum, line) => sum + wordsIn(clean(line.text)), 0);
  const minutes = (span.end - span.start) / MINUTE;
  return {
    wordCount,
    wordsPerMinute: minutes <= 0 ? 0 : Math.round(wordCount / minutes),
    sentenceCount: sentences.length,
    medianSentenceWords: round(median(counts)),
    averageSentenceWords:
      counts.length === 0
        ? 0
        : round(counts.reduce((sum, value) => sum + value, 0) / counts.length),
    hammers: sentences
      .filter(
        (sentence) => sentence.words >= HAMMER_MIN_WORDS && sentence.words <= HAMMER_MAX_WORDS,
      )
      .slice(0, MAX_HAMMERS),
  };
}

const normal = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Whether a quoted line is in the transcript, word for word (case and punctuation aside). */
export function quoteFound(lines: readonly TimedLine[], quote: string): boolean {
  const wanted = normal(quote);
  if (wanted === '') return false;
  return normal(lines.map((line) => clean(line.text)).join(' ')).includes(wanted);
}

import type { VideoTranscript } from '../sources/types';
import { transcriptPace } from '../video/transcriptText';
import { readingGrade, sentenceLength } from './measure';

/**
 * A channel's voice as numbers, measured in code from the captions of its own
 * best videos: how fast it speaks, how long its sentences are and what grade
 * it reads at. Nothing here is a preset, and nothing is fitted to a channel:
 * the same counts are taken for any channel the owner chooses.
 */

/** The videos a voice is measured over: the channel's best, as a breakdown takes them. */
export const VOICE_VIDEOS = 5;

export interface VoiceProfile {
  /** How many videos with captions the numbers come from. */
  readonly videos: number;
  /** How many of those had captions with sentence ends, which sentence length and grade need. */
  readonly punctuated: number;
  /** The middle pace of those videos; null when none gave one. */
  readonly wordsPerMinute: number | null;
  /** The middle of their typical sentence lengths, in words; null when no captions had sentence ends. */
  readonly sentenceWords: number | null;
  /** The middle of their reading grades (an estimate, English only); null when it cannot be told. */
  readonly grade: number | null;
}

/** The middle value of some numbers; null for none. */
function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const upper = sorted[Math.floor(sorted.length / 2)];
  const lower = sorted[Math.floor((sorted.length - 1) / 2)];
  return upper === undefined || lower === undefined ? null : (upper + lower) / 2;
}

const known = (values: readonly (number | null)[]): readonly number[] =>
  values.filter((value): value is number => value !== null);

/** The voice of the videos whose captions are given. */
export function voiceProfile(transcripts: readonly VideoTranscript[]): VoiceProfile {
  const texts = transcripts.map((transcript) =>
    transcript.segments.map((segment) => segment.text).join(' '),
  );
  const sentences = known(texts.map(sentenceLength));
  const pace = median(
    known(transcripts.map((transcript) => transcriptPace(transcript.segments).wordsPerMinute)),
  );
  return {
    videos: transcripts.length,
    punctuated: sentences.length,
    wordsPerMinute: pace === null ? null : Math.round(pace),
    sentenceWords: median(sentences),
    grade: median(known(texts.map((text) => readingGrade(text)))),
  };
}

/** A video this long or shorter is a Short, and says nothing about how long a full video runs. */
export const SHORTS_MAX_SECONDS = 60;
/** Fewer winners than this cannot show a range. */
export const LENGTH_MIN_VIDEOS = 3;
/** The share of the shortest and of the longest winners left out, so one odd video does not set the range. */
const LENGTH_TRIM_SHARE = 0.1;

export interface LengthRange {
  readonly minSeconds: number;
  readonly maxSeconds: number;
  /** The middle length of the winners. */
  readonly typicalSeconds: number;
  /** How many winners it was taken from. */
  readonly videos: number;
}

/**
 * How long a full-length video on this map may sensibly be: the lengths of
 * the look-alikes' winners, Shorts left out, without the shortest and the
 * longest tenth. Null when there are too few winners to show a range.
 */
export function lengthRange(durations: readonly number[]): LengthRange | null {
  const long = durations.filter((seconds) => seconds > SHORTS_MAX_SECONDS).sort((a, b) => a - b);
  const typical = median(long);
  if (long.length < LENGTH_MIN_VIDEOS || typical === null) return null;
  const trim = Math.floor(long.length * LENGTH_TRIM_SHARE);
  const kept = long.slice(trim, long.length - trim);
  return {
    minSeconds: kept[0] ?? typical,
    maxSeconds: kept.at(-1) ?? typical,
    typicalSeconds: typical,
    videos: long.length,
  };
}

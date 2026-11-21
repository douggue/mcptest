import type { TranscriptSegment } from '../sources/types';

/**
 * A transcript as text a reader can follow and quote from: the words run on,
 * with the time marked every half minute or so, which is close enough to find
 * a moment in the video without a stamp on every line.
 */

/** A time mark is written each time the captions pass another this many seconds. */
export const TRANSCRIPT_STAMP_SECONDS = 30;

const SECOND_MS = 1000;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3600;

/** A moment in a video as a viewer reads it: 0:05, 12:30, 1:02:03. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND_MS));
  const hours = Math.floor(total / HOUR_SECONDS);
  const minutes = Math.floor((total % HOUR_SECONDS) / MINUTE_SECONDS);
  const seconds = String(total % MINUTE_SECONDS).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

export interface TranscriptTextOptions {
  /** The most characters of text to return. */
  readonly maxChars: number;
  /** Leave out what is said before this moment. */
  readonly fromMs?: number;
}

export interface TranscriptText {
  /** One paragraph per time mark, each opening with its time in square brackets. */
  readonly text: string;
  /** Set when the text was cut: the moment the next call should start from. */
  readonly cutAtMs: number | null;
  /** When the last caption line starts; null for an empty transcript. */
  readonly endsAtMs: number | null;
}

interface Paragraph {
  readonly startMs: number;
  readonly words: readonly string[];
}

/** The lines gathered under a time mark every `TRANSCRIPT_STAMP_SECONDS` seconds. */
function paragraphs(segments: readonly TranscriptSegment[]): readonly Paragraph[] {
  const span = TRANSCRIPT_STAMP_SECONDS * SECOND_MS;
  return segments.reduce<readonly Paragraph[]>((done, segment) => {
    const current = done.at(-1);
    const sameSpan =
      current !== undefined &&
      Math.floor(current.startMs / span) === Math.floor(segment.startMs / span);
    return sameSpan
      ? [...done.slice(0, -1), { ...current, words: [...current.words, segment.text] }]
      : [...done, { startMs: segment.startMs, words: [segment.text] }];
  }, []);
}

/**
 * The transcript as text with a time mark every half minute or so, cut at a
 * paragraph boundary to fit `maxChars`. When it is cut, `cutAtMs` says where
 * to carry on from. At least one paragraph is always returned when there is
 * one, however small the limit.
 */
export function formatTranscript(
  segments: readonly TranscriptSegment[],
  options: TranscriptTextOptions,
): TranscriptText {
  const wanted = segments.filter((segment) => segment.startMs >= (options.fromMs ?? 0));
  const lines = paragraphs(wanted).map((paragraph) => ({
    startMs: paragraph.startMs,
    text: `[${clock(paragraph.startMs)}] ${paragraph.words.join(' ')}`,
  }));
  let used = 0;
  const kept = lines.filter((line, index) => {
    used += line.text.length + 1;
    return index === 0 || used <= options.maxChars;
  });
  const fits = kept.length === lines.length;
  return {
    text: kept.map((line) => line.text).join('\n'),
    cutAtMs: fits ? null : (lines[kept.length]?.startMs ?? null),
    endsAtMs: segments.at(-1)?.startMs ?? null,
  };
}

/** Captions shorter than this say too little to give a pace for. */
export const PACE_MIN_SECONDS = 30;
/**
 * Letters of the scripts that are written without spaces between words
 * (Chinese, Japanese, Thai, Lao, Khmer, Burmese). When most of a transcript
 * is in them, counting what sits between spaces counts nothing useful, and
 * no pace is given.
 */
const SPACELESS_LETTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;
/** A label for a sound, such as [Music], which the captions carry and nobody says. */
const SOUND_LABEL = /\[[^\]]*\]/g;

export interface TranscriptPace {
  /** Words said, sound labels left out. */
  readonly words: number;
  /** Seconds from the first caption line to the last. */
  readonly spokenSeconds: number;
  /** Words over that time, rounded; null when it cannot be told. */
  readonly wordsPerMinute: number | null;
}

/** The words a caption line holds, sound labels left out. */
const wordsOf = (segment: TranscriptSegment): readonly string[] =>
  segment.text.replace(SOUND_LABEL, ' ').split(/\s+/).filter(Boolean);

/**
 * Whether counting what sits between spaces counts words: not when most of
 * the letters belong to a script that is written without spaces.
 */
function countable(said: readonly string[]): boolean {
  const text = said.join('');
  const spaceless = text.match(SPACELESS_LETTER)?.length ?? 0;
  return said.length > 0 && spaceless * 2 <= text.length;
}

/**
 * How fast a video is spoken, worked out from its captions: the words said
 * over the time from the first line to the last. It is a count, not a
 * judgement, so a reader can quote it as it is.
 */
export function transcriptPace(segments: readonly TranscriptSegment[]): TranscriptPace {
  const said = segments.flatMap(wordsOf);
  const first = segments[0]?.startMs ?? 0;
  const last = segments.at(-1)?.startMs ?? 0;
  const spokenSeconds = Math.round((last - first) / SECOND_MS);
  const wordsPerMinute =
    countable(said) && spokenSeconds >= PACE_MIN_SECONDS
      ? Math.round((said.length * MINUTE_SECONDS) / spokenSeconds)
      : null;
  return { words: said.length, spokenSeconds, wordsPerMinute };
}

/** How long a slice of a video is when a reader does not say where to cut it. */
export const PACE_SLICE_SECONDS = 60;
/** A stretch shorter than this holds too few words to give a pace for. */
export const PACE_SPAN_MIN_SECONDS = 15;

/** The words said in one stretch of a video, and the pace they come to. */
export interface PaceSpan {
  readonly fromSeconds: number;
  /** Where the next stretch starts; for the last one, when the last caption line starts. */
  readonly toSeconds: number;
  readonly words: number;
  /** Words over the stretch's length, rounded; null when it cannot be told. */
  readonly wordsPerMinute: number | null;
}

/** Where the stretches start: the cuts given, in order and once each, with the beginning first. */
function spanStarts(cuts: readonly number[] | undefined, lastSeconds: number): readonly number[] {
  const given =
    cuts ??
    Array.from(
      { length: Math.floor(lastSeconds / PACE_SLICE_SECONDS) + 1 },
      (_, index) => index * PACE_SLICE_SECONDS,
    );
  const inside = given.filter((cut) => Number.isFinite(cut) && cut > 0 && cut < lastSeconds);
  return [...new Set([0, ...inside.map(Math.floor)])].sort((a, b) => a - b);
}

/**
 * How fast each stretch of a video is spoken, counted from its captions: a
 * line's words belong to the stretch it starts in. Without `cuts` the video
 * is cut every `PACE_SLICE_SECONDS`; with them, at those seconds, so a reader
 * who has found the parts of a script can have each part's pace counted
 * instead of working it out. The stretches run from the start of the video
 * to its last caption line.
 */
export function transcriptPaceSpans(
  segments: readonly TranscriptSegment[],
  cuts?: readonly number[],
): readonly PaceSpan[] {
  const lastMs = segments.at(-1)?.startMs;
  if (lastMs === undefined) return [];
  const lastSeconds = lastMs / SECOND_MS;
  const spoken = countable(segments.flatMap(wordsOf));
  const starts = spanStarts(cuts, lastSeconds);
  return starts.map((fromSeconds, index): PaceSpan => {
    const next = starts[index + 1];
    const toSeconds = next ?? Math.floor(lastSeconds);
    const words = segments
      .filter(
        ({ startMs }) =>
          startMs >= fromSeconds * SECOND_MS && (next === undefined || startMs < next * SECOND_MS),
      )
      .flatMap(wordsOf).length;
    const length = toSeconds - fromSeconds;
    return {
      fromSeconds,
      toSeconds,
      words,
      wordsPerMinute:
        spoken && length >= PACE_SPAN_MIN_SECONDS
          ? Math.round((words * MINUTE_SECONDS) / length)
          : null,
    };
  });
}

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

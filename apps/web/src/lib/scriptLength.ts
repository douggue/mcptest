import { wordsForSeconds } from '@jgtube/core/src/script/length';

/**
 * The script writer's two length fields, minutes and words, kept in step
 * through the speaking rate (core's `script/length`: to the nearest whole
 * second or word, halves up), and the quiet line when a length is outside
 * what the winners on the map run.
 */

const SECONDS_PER_MINUTE = 60;
const TWO_DIGITS = 2;

export interface TypedLength {
  readonly typed: 'minutes' | 'words';
  readonly words: number | null;
}

interface Range {
  readonly minSeconds: number;
  readonly maxSeconds: number;
}

/** Seconds as minutes and seconds: "12:30". */
export function minutesText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const rest = String(whole % SECONDS_PER_MINUTE).padStart(TWO_DIGITS, '0');
  return `${Math.floor(whole / SECONDS_PER_MINUTE)}:${rest}`;
}

/** What the two fields show for a stored length. */
export function lengthFields(
  seconds: number | null,
  wordsPerMinute: number | null,
  typed: TypedLength | null,
): { readonly minutes: string; readonly words: string } {
  if (seconds === null) return { minutes: '', words: '' };
  const words =
    typed?.typed === 'words' && typed.words !== null
      ? typed.words
      : wordsPerMinute === null
        ? null
        : wordsForSeconds(seconds, wordsPerMinute);
  return { minutes: minutesText(seconds), words: words === null ? '' : String(words) };
}

/** Words as typed: a whole number, commas and spaces allowed; null for anything else. */
export function readWords(text: string): number | null {
  const plain = text.replace(/[\s,]/g, '');
  return /^\d{1,6}$/.test(plain) ? Number(plain) : null;
}

/** One quiet line when a length is outside the winners' range; empty inside it or with no range. */
export function rangeNote(seconds: number, range: Range | null): string {
  if (range === null || (seconds >= range.minSeconds && seconds <= range.maxSeconds)) return '';
  const runs = `${minutesText(range.minSeconds)} to ${minutesText(range.maxSeconds)}`;
  const way = seconds < range.minSeconds ? 'Shorter' : 'Longer';
  return `${way} than the winners on this map, which run ${runs}.`;
}

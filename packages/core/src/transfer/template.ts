import { tokenize } from '../map/relevance';
import { findPlaces, straightQuotes, type FoundPlace, type Place } from './places';

/**
 * Turns a title into a template: the title in lower case with a slot where a
 * place was and a slot where a number or a sum of money was. Two titles that
 * are one idea made for two countries ("South Africa Just Found A Fuel…",
 * "Australia Just Found A Fuel…") have the same template.
 */

/** Stands where a title named a country, its people, a region or a US state. */
export const PLACE_SLOT = '{place}';
/** Stands where a title gave a number, a year or a sum of money. */
export const NUMBER_SLOT = '{n}';
/** Stands for the subject of a title format; see `formats.ts`. */
export const SUBJECT_SLOT = '{subject}';

const SLOTS: ReadonlySet<string> = new Set([PLACE_SLOT, NUMBER_SLOT, SUBJECT_SLOT]);
export const isSlot = (word: string): boolean => SLOTS.has(word);

/**
 * A number as titles write one: an optional currency sign, digits with
 * separators, and an optional size ("3k", "1.2 billion", "90%") or ordinal
 * ending ("6th"), not followed by more letters.
 */
const NUMBER =
  /[$€£]?\d[\d,.]*(?:\s?(?:k|m|bn|b|million|billion|trillion|%)|st|nd|rd|th)?(?![\p{L}\p{N}])/giu;
/** Emoji and other pictures: decoration, not wording. */
const PICTURE = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const SLOT_SPLIT = /(\{place\}|\{n\})/;

export interface TitleTemplate {
  /** The title in lower case with its slots, such as "{place} just found a fuel that shouldn't exist". */
  readonly text: string;
  /** The words that carry the idea, in order: the slots and the words that are not filler. */
  readonly words: readonly string[];
  /** The places the title named, in the order written. */
  readonly places: readonly Place[];
}

/** The title with each place word found in it replaced by the place slot. */
function withPlaceSlots(title: string, found: readonly FoundPlace[]): string {
  const pieces = found.map((place, index) => {
    const from = index === 0 ? 0 : (found[index - 1]?.end ?? 0);
    return `${title.slice(from, place.start)} ${PLACE_SLOT} `;
  });
  return pieces.join('') + title.slice(found.at(-1)?.end ?? 0);
}

/** A template's words: each slot as itself, the rest through the shared title tokenizer. */
function wordsOf(text: string): readonly string[] {
  return text.split(SLOT_SPLIT).flatMap((piece) => (isSlot(piece) ? [piece] : tokenize(piece)));
}

/** The template of one title. */
export function titleTemplate(title: string): TitleTemplate {
  const written = straightQuotes(title.normalize('NFKC')).replace(PICTURE, ' ');
  const found = findPlaces(written);
  const text = withPlaceSlots(written, found)
    .toLowerCase()
    .replace(NUMBER, ` ${NUMBER_SLOT} `)
    .replace(/\s+/g, ' ')
    .trim();
  return {
    text,
    words: wordsOf(text),
    places: found.map((entry) => entry.place),
  };
}

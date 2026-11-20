/**
 * A cheap stand-in for "is this channel in the owner's language". The owner
 * works in English, so a channel whose titles are mostly in another alphabet
 * (Cyrillic, Lao, Arabic and so on) is not a niche they can copy.
 *
 * It only tells alphabets apart: a channel in Spanish or German passes. That
 * is accepted here rather than adding a language detector.
 */

/**
 * The share of a channel's title letters that must be Latin.
 *
 * English titles are not purely Latin (a quoted foreign name, a brand), so the
 * bar is below 1. On the owner's store the rising channels fall into two
 * groups with nothing between: 0.96 and above (English) and 0.73 and below
 * (other alphabets, or a mix of both).
 */
export const NICHE_MIN_LATIN_SHARE = 0.8;

const LETTER = /\p{L}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

/**
 * Of the letters in these titles, the share written in the Latin alphabet,
 * 0 to 1. Digits, punctuation and emoji are not counted. With no letter to
 * judge by the answer is 0: nothing shows the titles can be read.
 */
export function latinShare(titles: readonly string[]): number {
  const letters = [...titles.join(' ')].filter((character) => LETTER.test(character));
  if (letters.length === 0) return 0;
  return letters.filter((character) => LATIN_LETTER.test(character)).length / letters.length;
}

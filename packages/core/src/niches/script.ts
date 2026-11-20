/**
 * A cheap stand-in for "is this channel in another language". A channel whose
 * titles are mostly in another alphabet than Latin (Cyrillic, Arabic, Thai and
 * so on) is making its videos for another audience: an idea that works there
 * may not have been made for the owner's audience yet, so the niche list marks
 * such a channel as "other language" instead of leaving it out.
 *
 * It only tells alphabets apart: a channel in Spanish or German reads as Latin.
 * That is accepted here rather than adding a language detector, and nothing is
 * translated.
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

/**
 * The scripts that are named, by the Unicode script each letter belongs to.
 * Chinese characters and the two Japanese syllabaries are counted together as
 * "CJK": a Japanese title mixes all three, and Han alone cannot tell Chinese
 * from Japanese. A script not listed here is still another alphabet; it just
 * goes unnamed.
 */
const NAMED_SCRIPTS: readonly (readonly [name: string, letter: RegExp])[] = [
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['CJK', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['Korean', /\p{Script=Hangul}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Bengali', /\p{Script=Bengali}/u],
  ['Tamil', /\p{Script=Tamil}/u],
  ['Telugu', /\p{Script=Telugu}/u],
  ['Gujarati', /\p{Script=Gujarati}/u],
  ['Gurmukhi', /\p{Script=Gurmukhi}/u],
  ['Kannada', /\p{Script=Kannada}/u],
  ['Malayalam', /\p{Script=Malayalam}/u],
  ['Sinhala', /\p{Script=Sinhala}/u],
  ['Lao', /\p{Script=Lao}/u],
  ['Khmer', /\p{Script=Khmer}/u],
  ['Burmese', /\p{Script=Myanmar}/u],
  ['Georgian', /\p{Script=Georgian}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Ethiopic', /\p{Script=Ethiopic}/u],
];

/**
 * The name of the script, other than Latin, that most of these titles' letters
 * are written in; null when there is none or it is not one of the named ones.
 */
export function dominantScript(titles: readonly string[]): string | null {
  const letters = [...titles.join(' ')].filter((character) => LETTER.test(character));
  const counted = NAMED_SCRIPTS.map(([name, letter]) => ({
    name,
    count: letters.filter((character) => letter.test(character)).length,
  }));
  const most = Math.max(0, ...counted.map((entry) => entry.count));
  return most > 0 ? (counted.find((entry) => entry.count === most)?.name ?? null) : null;
}

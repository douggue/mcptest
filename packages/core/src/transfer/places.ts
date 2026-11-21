import { PLACE_ENTRIES, type PlaceEntry } from './placeList';

/**
 * Finds the place words in a title: countries, the adjectives for their
 * people, possessives ("Germany's") and a few regions and US states.
 */

/** A place as the rest of the tool refers to it. */
export interface Place {
  /** A country's two-letter ISO code ("ZA"), or "region:africa", "state:texas". */
  readonly key: string;
  /** The name shown, such as "South Africa". */
  readonly name: string;
}

export interface FoundPlace {
  readonly place: Place;
  /** Where the place word starts and ends in the title, possessive ending included. */
  readonly start: number;
  readonly end: number;
}

/**
 * A title with more than this share of its letters in capitals is shouting:
 * every word is in capitals, so capitals no longer mark an abbreviation. Past
 * a half, the capitals are the title's style and not a choice made per word.
 */
const SHOUTING_MIN_CAPITAL_SHARE = 0.5;

const COUNTRY_CODE = /^[A-Za-z]{2}$/;
const LETTER = /\p{L}/u;
const CAPITAL = /\p{Lu}/u;
const toPlace = (entry: PlaceEntry): Place => ({ key: entry.key, name: entry.name });

const BY_WORD: ReadonlyMap<string, PlaceEntry> = new Map(
  PLACE_ENTRIES.flatMap((entry) => entry.words.map((word) => [word, entry] as const)),
);
const BY_KEY: ReadonlyMap<string, PlaceEntry> = new Map(
  PLACE_ENTRIES.map((entry) => [entry.key, entry]),
);
const CAPITALS_ONLY: ReadonlySet<string> = new Set(
  PLACE_ENTRIES.flatMap((entry) => entry.capitalsOnly),
);

/** One letter of the place words, and the letters that can follow it. */
interface Letters {
  readonly next: Map<string, Letters>;
  /** A place word ends here. */
  ends: boolean;
}

/**
 * The place words as a tree of letters, built once. Trying hundreds of names
 * one after another at every word of every title was most of the cost of
 * reading a store; walking the tree reads each word once.
 */
function lettersOf(words: readonly string[]): Letters {
  const root: Letters = { next: new Map(), ends: false };
  for (const word of words) {
    const last = [...word].reduce((node, letter) => {
      const known = node.next.get(letter) ?? { next: new Map(), ends: false };
      node.next.set(letter, known);
      return known;
    }, root);
    last.ends = true;
  }
  return root;
}

const PLACE_LETTERS = lettersOf([...BY_WORD.keys()]);
/** What may follow a place word and still be the same word: a possessive or a plural. */
const ENDINGS = ["'s", "s'", 's', ''] as const;
const ASCII_LIMIT = 128;
const ASCII_WORD_CHARACTER = /[A-Za-z0-9]/;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** Curly apostrophes read as straight ones, so "Germany’s" and "Germany's" match alike. */
export const straightQuotes = (text: string): string => text.replace(/[’‘`´]/g, "'");

/** Whether the character at a position is a letter or a digit; false past either end. */
function isWordCharacter(text: string, position: number): boolean {
  const character = text.charAt(position);
  if (character === '') return false;
  return character.charCodeAt(0) < ASCII_LIMIT
    ? ASCII_WORD_CHARACTER.test(character)
    : WORD_CHARACTER.test(character);
}

/** Where a place word ending at `wordEnd` stops once its ending is counted, or -1 when it runs on. */
function endWithEnding(lower: string, wordEnd: number): number {
  const ending = ENDINGS.find(
    (candidate) =>
      lower.startsWith(candidate, wordEnd) && !isWordCharacter(lower, wordEnd + candidate.length),
  );
  return ending === undefined ? -1 : wordEnd + ending.length;
}

interface WordMatch {
  /** The place word, in lower case, without its ending. */
  readonly word: string;
  readonly end: number;
}

/** The longest place word that starts at a position, so "South Korea" is not read as "Korea". */
function placeWordAt(lower: string, start: number): WordMatch | null {
  let node: Letters | undefined = PLACE_LETTERS;
  let longest: WordMatch | null = null;
  for (let position = start; position < lower.length; position += 1) {
    node = node.next.get(lower.charAt(position));
    if (node === undefined) break;
    const end = node.ends ? endWithEnding(lower, position + 1) : -1;
    if (end >= 0) longest = { word: lower.slice(start, position + 1), end };
  }
  return longest;
}

function isShouting(title: string): boolean {
  const letters = [...title].filter((character) => LETTER.test(character));
  const capitals = letters.filter((character) => CAPITAL.test(character));
  return letters.length > 0 && capitals.length / letters.length > SHOUTING_MIN_CAPITAL_SHARE;
}

/**
 * Whether a matched word is written as a place. A place is a proper noun, so
 * it starts with a capital: "turkey" and "china" in small letters are a bird
 * and crockery. An abbreviation that is also a common word ("US") must be in
 * capitals throughout, in a title that is not all capitals anyway.
 */
function writtenAsPlace(text: string, start: number, word: string): boolean {
  const written = text.slice(start, start + word.length);
  if (CAPITALS_ONLY.has(word)) return written === word.toUpperCase() && !isShouting(text);
  return CAPITAL.test(written.charAt(0));
}

/** The places named in a title, in the order written. The title is not changed. */
export function findPlaces(title: string): readonly FoundPlace[] {
  const text = straightQuotes(title);
  // Place words are written in plain letters, so only those are lowered: the
  // text keeps its length and a position in one is the same position in the other.
  const lower = text.replace(/[A-Z]+/g, (capitals) => capitals.toLowerCase());
  const found: FoundPlace[] = [];
  let position = 0;
  while (position < text.length) {
    const startsWord = isWordCharacter(text, position) && !isWordCharacter(text, position - 1);
    const match = startsWord ? placeWordAt(lower, position) : null;
    const entry = match ? BY_WORD.get(match.word) : undefined;
    if (match && entry && writtenAsPlace(text, position, match.word)) {
      found.push({ place: toPlace(entry), start: position, end: match.end });
      position = match.end;
    } else {
      position += 1;
    }
  }
  return found;
}

/** Every place Jgtube knows, by name: what the owner chooses their place from. */
export function listPlaces(): readonly Place[] {
  return PLACE_ENTRIES.map(toPlace).sort((a, b) => a.name.localeCompare(b.name));
}

/** The place with this key, or null when the list holds none. */
export function placeForKey(key: string | null | undefined): Place | null {
  const entry = key ? BY_KEY.get(key) : undefined;
  return entry ? toPlace(entry) : null;
}

/** The place for a channel's two-letter country, or null when it has none or it is not known. */
export function placeForCountry(country: string | null | undefined): Place | null {
  const code = (country ?? '').toUpperCase();
  const entry = COUNTRY_CODE.test(code) ? BY_KEY.get(code) : undefined;
  return entry ? toPlace(entry) : null;
}

/** The place a person means by a name, an adjective or a country code; null when none is known. */
export function placeNamed(text: string): Place | null {
  const wanted = straightQuotes(text).trim();
  const entry = BY_WORD.get(wanted.toLowerCase()) ?? BY_KEY.get(wanted.toUpperCase());
  return entry ? toPlace(entry) : null;
}

/**
 * Measures of a script, counted in code so that no number about it is ever a
 * model's guess: the words spoken, how long they take at a speaking rate, a
 * reading grade, and the facts still marked to be checked.
 *
 * A script is plain text with three kinds of mark. A line that starts with
 * "## " is a heading. A line of the form "[B-ROLL: ...]" is a picture cue. And
 * "[CHECK: what to verify]" after a claim marks a fact the writer could not
 * know. None of the three is spoken, so none counts as words.
 */

/** A heading line: the name of a part of the script. */
export const HEADING_LINE = /^##\s+/;
/** A picture cue on a line of its own. */
export const CUE_LINE = /^\[B-ROLL:(.*)\]\s*$/;
/** A marker after a claim that must be checked. */
const CHECK_MARKER = /\[CHECK:\s*([^\]]*)\]/g;
/** A marker naming a fact of the concept's fact sheet, such as [F3]: shown as a link, never spoken. */
const FACT_MARKER = /\[F\d{1,3}\]/g;
const SECONDS_PER_MINUTE = 60;

const isSpoken = (line: string): boolean =>
  !HEADING_LINE.test(line.trim()) && !CUE_LINE.test(line.trim());

/** A line without its check markers, and without the gap a marker leaves before punctuation. */
function withoutMarkers(line: string): string {
  return line
    .replace(CHECK_MARKER, '')
    .replace(FACT_MARKER, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Only what is said: the script without its headings, its picture cues and
 * its check markers. The claim a marker follows stays; line breaks stay.
 */
export function spokenText(script: string): string {
  return script
    .split('\n')
    .filter(isSpoken)
    .map(withoutMarkers)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The whole script with its check markers taken out: headings, picture cues
 * and every claim stay. For an owner who has chosen not to have facts marked.
 */
export function stripCheckMarkers(script: string): string {
  return script
    .split('\n')
    .map((line) => (line.includes('[CHECK:') ? withoutMarkers(line) : line))
    .join('\n');
}

/** The spoken text as paragraphs with one empty line between them, ready to hand to a voice. */
export function cleanVoiceover(script: string): string {
  return spokenText(script)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter((paragraph) => paragraph !== '')
    .join('\n\n');
}

/** The words of a text: what stands between spaces and holds a letter or a digit. */
function wordsOf(text: string): readonly string[] {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
}

/** How many words are spoken. Headings, cues and markers count for nothing. */
export function countWords(script: string): number {
  return wordsOf(spokenText(script)).length;
}

/** How long that many words take to say at a rate, in seconds; null without a rate. */
export function spokenSeconds(words: number, wordsPerMinute: number): number | null {
  if (!Number.isFinite(wordsPerMinute) || wordsPerMinute <= 0) return null;
  return Math.round((words * SECONDS_PER_MINUTE) / wordsPerMinute);
}

/** A fact the script marks as not yet checked. */
export interface CheckMarker {
  /** What to verify, in the writer's words. */
  readonly what: string;
  /** The sentence the marker stands in, without the marker. */
  readonly near: string;
}

/** The sentence around a position in a line: from the end of the one before to its own end. */
function sentenceAround(line: string, at: number, after: number): string {
  const before = line.slice(0, at);
  const start = Math.max(
    before.lastIndexOf('. '),
    before.lastIndexOf('! '),
    before.lastIndexOf('? '),
  );
  const rest = line.slice(after);
  const end = rest.search(/[.!?](\s|$)/);
  const sentence = line.slice(start < 0 ? 0 : start + 2, end < 0 ? line.length : after + end + 1);
  return withoutMarkers(sentence);
}

/** Every check marker in the spoken lines of a script, in order. */
export function checkMarkers(script: string): readonly CheckMarker[] {
  return script
    .split('\n')
    .filter(isSpoken)
    .flatMap((line) =>
      [...line.matchAll(CHECK_MARKER)].map((match) => ({
        what: (match[1] ?? '').trim(),
        near: sentenceAround(line, match.index, match.index + match[0].length),
      })),
    );
}

/** Stands where a marker stood while a line is cut into sentences, so a full stop inside it cuts nothing. */
const MARKED = '\u2063';

/**
 * The sentences that hold a figure (a digit) and no check marker. A number, a
 * year or a sum of money is the plainest kind of fact a writer without the
 * web cannot know, so one nobody marked is worth a second look. It is a help
 * for the reader's eye, not a judgement: a sentence without digits can state
 * an unchecked fact too.
 */
export function figuresWithoutCheck(script: string): readonly string[] {
  return script
    .split('\n')
    .filter(isSpoken)
    .flatMap((line) => line.replace(CHECK_MARKER, MARKED).match(/[^.!?]+[.!?]*/g) ?? [])
    .filter((sentence) => /\d/.test(sentence) && !sentence.includes(MARKED))
    .map((sentence) => sentence.trim());
}

const VOWEL_GROUPS = /[aeiouy]+/g;

/**
 * The syllables of a word, by one stated rule: each run of vowels (a, e, i,
 * o, u, y) is one syllable; a final "e" is silent and is not counted, unless
 * the word ends in a consonant and "le" or has no other vowel; a word with
 * letters or digits has at least one. It is a rule of thumb for English and
 * miscounts some words ("idea" as two).
 */
export function countSyllables(word: string): number {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '');
  if (letters === '') return /\p{N}|\p{L}/u.test(word) ? 1 : 0;
  const groups = letters.match(VOWEL_GROUPS)?.length ?? 0;
  const silentE = /[^aeiouy]e$/.test(letters) && !/[^aeiouy]le$/.test(letters);
  return Math.max(1, silentE ? groups - 1 : groups);
}

/** At least this share of a text's letters must be Latin for English measures to mean anything. */
export const LATIN_MIN_SHARE = 0.8;

/** Whether a text is written mostly in Latin script, going by its letters. */
export function isMostlyLatin(text: string): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return letters > 0 && latin / letters >= LATIN_MIN_SHARE;
}

/**
 * Past this many words to a sentence, on average, a text has no real sentence
 * ends: captions made by listening often carry no full stops at all.
 */
const MAX_SENTENCE_WORDS = 60;
/** Fewer words than this say too little for a grade. */
const GRADE_MIN_WORDS = 30;
/** The Flesch-Kincaid grade formula's weights: words a sentence, syllables a word, and its offset. */
const FK_SENTENCE_WEIGHT = 0.39;
const FK_SYLLABLE_WEIGHT = 11.8;
const FK_OFFSET = 15.59;

/** The sentences of the spoken text, each as its words; empty sentences are left out. */
function sentencesOf(script: string): readonly (readonly string[])[] {
  return spokenText(script)
    .split(/[.!?]+(?:\s+|$)/)
    .map(wordsOf)
    .filter((words) => words.length > 0);
}

/** The sentences when the text really has sentence ends, else null. */
function punctuated(script: string): readonly (readonly string[])[] | null {
  const sentences = sentencesOf(script);
  const words = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
  return sentences.length > 0 && words / sentences.length <= MAX_SENTENCE_WORDS ? sentences : null;
}

/**
 * The typical sentence: the median number of words in one. Null for a text
 * without sentence ends, where no sentence can be told from the next.
 */
export function sentenceLength(script: string): number | null {
  const lengths = (punctuated(script) ?? [])
    .map((sentence) => sentence.length)
    .sort((a, b) => a - b);
  const middle = lengths[Math.floor(lengths.length / 2)];
  if (middle === undefined) return null;
  const lower = lengths[Math.floor((lengths.length - 1) / 2)] ?? middle;
  return (lower + middle) / 2;
}

/**
 * The Flesch-Kincaid grade of the spoken text: roughly the school year at
 * which it reads easily. It is an estimate, and for English only: it rests
 * on counting syllables by `countSyllables`' rule and on sentence ends, so it
 * is null for text that is not mostly in Latin script, has no sentence ends,
 * or is too short to judge.
 */
export function readingGrade(
  script: string,
  options: { readonly minWords?: number } = {},
): number | null {
  const sentences = punctuated(script);
  if (sentences === null || !isMostlyLatin(spokenText(script))) return null;
  const words = sentences.flat();
  if (words.length < (options.minWords ?? GRADE_MIN_WORDS)) return null;
  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  return (
    FK_SENTENCE_WEIGHT * (words.length / sentences.length) +
    FK_SYLLABLE_WEIGHT * (syllables / words.length) -
    FK_OFFSET
  );
}

import { median } from './shots';

/**
 * Title patterns counted in code over two groups of titles (winners against
 * ordinary ones): how long they are and what they carry. Each pattern is a
 * plain rule anyone can check by reading the titles; the word lists are
 * short, fixed and the same for every channel.
 */

/** Words that make a claim of degree. */
const SUPERLATIVES = new Set([
  'most',
  'least',
  'best',
  'worst',
  'biggest',
  'smallest',
  'largest',
  'fastest',
  'slowest',
  'richest',
  'poorest',
  'strongest',
  'weakest',
  'deadliest',
  'greatest',
  'longest',
  'shortest',
  'highest',
  'lowest',
  'oldest',
  'newest',
  'only',
  'first',
  'last',
  'ever',
]);
/** Words that promise a feeling or a secret. */
const CHARGED = new Set([
  'secret',
  'secrets',
  'shocking',
  'insane',
  'crazy',
  'terrifying',
  'scary',
  'dangerous',
  'deadly',
  'impossible',
  'incredible',
  'unbelievable',
  'truth',
  'hidden',
  'banned',
  'forbidden',
  'mystery',
  'disaster',
  'collapse',
  'war',
  'never',
  'finally',
  'really',
  'actually',
  'why',
  'how',
]);
const SECOND_PERSON = new Set(['you', 'your', "you're", 'yours']);
const FIRST_PERSON = new Set(['i', 'my', 'we', 'our', "i'm", 'me', 'us']);

export const TITLE_PATTERNS = [
  { key: 'number', label: 'Carries a number', test: (t: string) => /\d/.test(t) },
  {
    key: 'year',
    label: 'Carries a year (1900–2099)',
    test: (t: string) => /\b(19|20)\d{2}\b/.test(t),
  },
  {
    key: 'money',
    label: 'Carries an amount of money',
    test: (t: string) => /[$€£¥]\s?\d|\d\s?(dollars|euros|billion|million|trillion)\b/i.test(t),
  },
  {
    key: 'question',
    label: 'Ends in or holds a question mark',
    test: (t: string) => t.includes('?'),
  },
  { key: 'exclamation', label: 'Holds an exclamation mark', test: (t: string) => t.includes('!') },
  {
    key: 'split',
    label: 'Split by a colon, dash or bar',
    test: (t: string) => /[:|–—]|\s-\s/.test(t),
  },
  {
    key: 'caps',
    label: 'Has a word in capitals (2+ letters)',
    test: (t: string) => /\b[A-Z]{2,}\b/.test(t),
  },
  {
    key: 'named',
    label: 'Has a capitalised word after the first (a name, place or product, roughly)',
    test: (t: string) =>
      wordsOf(t)
        .slice(1)
        .some((word) => /^\p{Lu}\p{Ll}/u.test(word)),
  },
  {
    key: 'you',
    label: 'Speaks to "you"',
    test: (t: string) => lowerWords(t).some((word) => SECOND_PERSON.has(word)),
  },
  {
    key: 'me',
    label: 'Speaks as "I" or "we"',
    test: (t: string) => lowerWords(t).some((word) => FIRST_PERSON.has(word)),
  },
  {
    key: 'superlative',
    label: 'Has a word of degree (most, biggest, only, ever …)',
    test: (t: string) => lowerWords(t).some((word) => SUPERLATIVES.has(word)),
  },
  {
    key: 'charged',
    label: 'Has a charged word (secret, why, never, truth …)',
    test: (t: string) => lowerWords(t).some((word) => CHARGED.has(word)),
  },
] as const;

function wordsOf(title: string): string[] {
  return title.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
}
const lowerWords = (title: string): string[] =>
  wordsOf(title).map((word) => word.toLowerCase().replace('’', "'"));

export interface PatternCount {
  readonly key: string;
  readonly label: string;
  readonly winners: number;
  readonly ordinary: number;
}

export interface TitleFacts {
  readonly winners: number;
  readonly ordinary: number;
  readonly medianWords: { readonly winners: number; readonly ordinary: number };
  readonly medianChars: { readonly winners: number; readonly ordinary: number };
  readonly patterns: readonly PatternCount[];
  /** The opening word pairs that recur among the winners, with how many winners and ordinary titles open so. */
  readonly openings: readonly {
    readonly words: string;
    readonly winners: number;
    readonly ordinary: number;
  }[];
  readonly method: string;
}

const MAX_OPENINGS = 8;
const opening = (title: string): string => lowerWords(title).slice(0, 2).join(' ');

/** The patterns counted over winners and ordinary titles. */
export function titleFacts(winners: readonly string[], ordinary: readonly string[]): TitleFacts {
  const count = (titles: readonly string[], test: (title: string) => boolean) =>
    titles.filter(test).length;
  const openingsSeen = new Map<string, number>();
  for (const title of winners)
    openingsSeen.set(opening(title), (openingsSeen.get(opening(title)) ?? 0) + 1);
  return {
    winners: winners.length,
    ordinary: ordinary.length,
    medianWords: {
      winners: median(winners.map((t) => wordsOf(t).length)),
      ordinary: median(ordinary.map((t) => wordsOf(t).length)),
    },
    medianChars: {
      winners: median(winners.map((t) => t.length)),
      ordinary: median(ordinary.map((t) => t.length)),
    },
    patterns: TITLE_PATTERNS.map((pattern) => ({
      key: pattern.key,
      label: pattern.label,
      winners: count(winners, pattern.test),
      ordinary: count(ordinary, pattern.test),
    })),
    openings: [...openingsSeen]
      .filter(([words, seen]) => words !== '' && seen > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_OPENINGS)
      .map(([words, seen]) => ({
        words,
        winners: seen,
        ordinary: count(ordinary, (title) => opening(title) === words),
      })),
    method:
      'counted in code over the titles of the high group (winners) and the low group (ordinary) of the ranking by views; each pattern is a fixed rule, the same for every channel',
  };
}

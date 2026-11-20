/**
 * A cheap first read on whether a channel makes the same kind of video as a
 * reference channel: how much of the wording of its titles is the reference's
 * title format, with words that few channels on the map use weighted up.
 *
 * A title is a format plus a subject ("America's New Invention Could Replace
 * … Forever" plus "Car Mirrors"). Look-alikes share the format and cover
 * different subjects, so the reference is read as a format profile: each word
 * counts by the share of the reference's titles that use it. A word in half of
 * them is format; a word in one of a hundred is one video's subject and counts
 * for next to nothing. Counting every reference word about equally, as an
 * earlier version did, let channels that merely touch the same subjects
 * (aircraft, Tesla, batteries) score as high as real look-alikes.
 *
 * It cannot tell that two channels serve the same audience in different words;
 * a judged pass by a model comes later for that.
 */

const MIN_TOKEN_LENGTH = 2;
const STOPWORDS: ReadonlySet<string> = new Set([
  'of',
  'to',
  'in',
  'on',
  'is',
  'it',
  'at',
  'by',
  'an',
  'as',
  'be',
  'or',
  'we',
  'my',
  'no',
  'so',
  'do',
  'if',
  'up',
  'us',
  'he',
  'me',
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'was',
  'are',
  'were',
  'has',
  'have',
  'had',
  'its',
  'you',
  'your',
  'our',
  'out',
  'not',
  'but',
  'all',
  'can',
  'will',
  'into',
  'than',
  'then',
  'them',
  'they',
  'their',
  'his',
  'her',
  'she',
  'him',
  'who',
  'what',
  'when',
  'where',
  'which',
  'about',
  'after',
  'over',
  'been',
  'does',
  'did',
  'too',
  'very',
]);

/**
 * A title's words in lower case, in order, without the short and the common
 * ones that say nothing about what the video is.
 */
export function tokenize(title: string): readonly string[] {
  return title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
}

/** One channel's titles with every word replaced by its number in the index. */
interface WordUse {
  /** The distinct words the titles use. */
  readonly words: Int32Array;
  /** For each of those words, how many of the titles use it. */
  readonly titlesUsing: Float64Array;
  /** For each of those words, 1 + ln(times it occurs): the damped count a candidate is scored with. */
  readonly damped: Float64Array;
  readonly titleCount: number;
}

/**
 * A reference and the channels around it, read once. Every word gets a number,
 * so a scoring pass is arithmetic on arrays; the same index can then be scored
 * many times over, on the whole map and on parts of it.
 */
export interface TitleIndex {
  /** How many different words the reference and the channels use between them. */
  readonly wordCount: number;
  readonly reference: WordUse;
  readonly channels: ReadonlyMap<string, WordUse>;
}

function wordUse(titles: readonly string[], numberOf: (word: string) => number): WordUse {
  const occurrences = new Map<number, number>();
  const titlesUsing = new Map<number, number>();
  for (const title of titles) {
    const words = tokenize(title).map(numberOf);
    for (const word of words) occurrences.set(word, (occurrences.get(word) ?? 0) + 1);
    for (const word of new Set(words)) titlesUsing.set(word, (titlesUsing.get(word) ?? 0) + 1);
  }
  const words = Int32Array.from(occurrences.keys());
  return {
    words,
    titlesUsing: Float64Array.from(words, (word) => titlesUsing.get(word) ?? 0),
    damped: Float64Array.from(words, (word) => 1 + Math.log(occurrences.get(word) ?? 1)),
    titleCount: titles.length,
  };
}

/** Reads the reference's titles and every candidate's, numbering each word once. */
export function indexTitles(
  referenceTitles: readonly string[],
  candidates: ReadonlyMap<string, readonly string[]>,
): TitleIndex {
  const numbers = new Map<string, number>();
  const numberOf = (word: string): number => {
    const known = numbers.get(word);
    if (known !== undefined) return known;
    numbers.set(word, numbers.size);
    return numbers.size - 1;
  };
  const reference = wordUse(referenceTitles, numberOf);
  const channels = new Map(
    [...candidates].map(([id, titles]) => [id, wordUse(titles, numberOf)] as const),
  );
  return { wordCount: numbers.size, reference, channels };
}

/** A format profile: the share (0 to 1) of a reference's titles that use each of its words. */
interface Profile {
  readonly words: Int32Array;
  readonly shares: Float64Array;
}

const profileOf = (shares: ReadonlyMap<number, number>): Profile => ({
  words: Int32Array.from(shares.keys()),
  shares: Float64Array.from(shares.values()),
});

/** The share of these channels' titles, taken together, that use each word. */
function titleShares(uses: readonly WordUse[]): ReadonlyMap<number, number> {
  const titles = uses.reduce((sum, use) => sum + use.titleCount, 0);
  const counts = new Map<number, number>();
  for (const use of uses) {
    use.words.forEach((word, at) => {
      counts.set(word, (counts.get(word) ?? 0) + (use.titlesUsing[at] ?? 0));
    });
  }
  return new Map([...counts].map(([word, count]) => [word, count / titles]));
}

/** Two sets of title shares merged, each counting for the given number of titles. */
function blendShares(
  own: ReadonlyMap<number, number>,
  ownVotes: number,
  lent: ReadonlyMap<number, number>,
  lentVotes: number,
): ReadonlyMap<number, number> {
  const words = new Set([...own.keys(), ...lent.keys()]);
  return new Map(
    [...words].map((word) => [
      word,
      ((own.get(word) ?? 0) * ownVotes + (lent.get(word) ?? 0) * lentVotes) /
        (ownVotes + lentVotes),
    ]),
  );
}

type Scored = readonly (readonly [string, WordUse])[];

/** For every word, how many of the documents being scored (the profile and each candidate) use it. */
function documentsUsing(profile: Profile, candidates: Scored, wordCount: number): Int32Array {
  const usedBy = new Int32Array(wordCount);
  for (const word of profile.words) usedBy[word] = 1;
  for (const [, use] of candidates) {
    for (const word of use.words) usedBy[word] = (usedBy[word] ?? 0) + 1;
  }
  return usedBy;
}

/**
 * Scores each candidate against a format profile: the cosine of the two once
 * every word is weighted by its rarity among the documents being scored,
 * ln((documents + 1) / (documents using it + 1)) + 1.
 *
 * The two sides are weighted differently on purpose. The profile is linear in
 * the share, which is what separates format from subject. A candidate may have
 * only a handful of titles, too few to tell its own format from its subjects,
 * so every word it uses gets a say and repeats are damped; were its counts
 * linear too, one word it repeats in every title could carry the whole match.
 */
function scoreAgainst(
  profile: Profile,
  candidates: Scored,
  wordCount: number,
): ReadonlyMap<string, number> {
  const usedBy = documentsUsing(profile, candidates, wordCount);
  const documents = candidates.length + 1;
  // Rarity depends on the word only through how many documents use it.
  const rarityAt = Float64Array.from(
    { length: documents + 1 },
    (_, count) => Math.log((documents + 1) / (count + 1)) + 1,
  );
  const rarity = (word: number): number => rarityAt[usedBy[word] ?? 0] ?? 0;
  const weighted = new Float64Array(wordCount);
  profile.words.forEach((word, at) => {
    weighted[word] = (profile.shares[at] ?? 0) * rarity(word);
  });
  const profileLength = Math.sqrt(
    profile.words.reduce((sum, word) => sum + (weighted[word] ?? 0) ** 2, 0),
  );
  return new Map(
    candidates.map(([id, use]) => {
      const weights = use.damped.map((count, at) => count * rarity(use.words[at] ?? 0));
      const dot = weights.reduce(
        (sum, weight, at) => sum + weight * (weighted[use.words[at] ?? 0] ?? 0),
        0,
      );
      const scale = profileLength * Math.sqrt(weights.reduce((sum, w) => sum + w * w, 0));
      return [id, scale === 0 ? 0 : dot / scale] as const;
    }),
  );
}

/**
 * How much each candidate's titles are written in the reference's format, from
 * 0 (nothing shared) to nearly 1 (the same titles).
 */
export function titleSimilarity(
  centerTitles: readonly string[],
  candidates: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, number> {
  const index = indexTitles(centerTitles, candidates);
  return scoreAgainst(
    profileOf(titleShares([index.reference])),
    [...index.channels],
    index.wordCount,
  );
}

/** How many of the closest look-alikes join the reference for the second pass. */
export const MAX_ANCHORS = 3;

/**
 * The most titles the look-alikes can count for together in the reference:
 * one channel's worth. Without a limit, three look-alikes with thirty titles
 * each outvote a model channel's own thirty three to one and blur its format.
 * A new channel with three titles is still led by its look-alikes, as intended.
 */
export const MAX_ANCHOR_TITLE_VOTES = 30;

export interface AnchoredSimilarity {
  readonly scores: ReadonlyMap<string, number>;
  /** The look-alikes whose titles were added to the reference's. */
  readonly anchors: readonly string[];
}

/**
 * Anchored title similarity for some of an index's channels. `ids` are the
 * channels on the map being read (all of the index, or a part of it): only
 * they are scored, counted for rarity, or able to lend their titles. See
 * `anchoredTitleSimilarity` for the two passes.
 */
export function anchoredSimilarityOf(
  index: TitleIndex,
  ids: readonly string[],
  anchorPool: readonly string[],
): AnchoredSimilarity {
  const scored = ids.flatMap((id) => {
    const use = index.channels.get(id);
    return use ? [[id, use] as const] : [];
  });
  const own = titleShares([index.reference]);
  const first = scoreAgainst(profileOf(own), scored, index.wordCount);
  const anchors = [...anchorPool]
    .filter((id) => (first.get(id) ?? 0) > 0)
    .sort((a, b) => (first.get(b) ?? 0) - (first.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, MAX_ANCHORS);
  if (anchors.length === 0) return { scores: first, anchors };
  const lenders = anchors.flatMap((id) => index.channels.get(id) ?? []);
  const lentTitles = lenders.reduce((sum, use) => sum + use.titleCount, 0);
  const profile = blendShares(
    own,
    index.reference.titleCount,
    titleShares(lenders),
    Math.min(lentTitles, MAX_ANCHOR_TITLE_VOTES),
  );
  return { scores: scoreAgainst(profileOf(profile), scored, index.wordCount), anchors };
}

/**
 * Title similarity when the reference alone describes its niche too narrowly.
 *
 * A first pass scores every candidate against the reference's own titles. The
 * best few from `anchorPool` (channels that could plausibly be peers; the
 * caller leaves the reference itself out) then lend their titles, and a second
 * pass scores everyone against the merged profile. Each title is one vote,
 * except that the lent titles together get at most `MAX_ANCHOR_TITLE_VOTES`.
 * With three titles the first pass barely separates a look-alike (12%) from a
 * news network (2%); the second separates them clearly. With a full reference
 * the look-alikes add its sister formats (the same videos about Britain).
 */
export function anchoredTitleSimilarity(
  centerTitles: readonly string[],
  candidates: ReadonlyMap<string, readonly string[]>,
  anchorPool: readonly string[],
): AnchoredSimilarity {
  const index = indexTitles(centerTitles, candidates);
  return anchoredSimilarityOf(index, [...candidates.keys()], anchorPool);
}

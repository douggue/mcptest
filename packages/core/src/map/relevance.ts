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

type Vector = ReadonlyMap<string, number>;

function tokenize(title: string): readonly string[] {
  return title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
}

/** How often each word occurs across a channel's titles. */
function termCounts(titles: readonly string[]): Vector {
  const counts = new Map<string, number>();
  for (const token of titles.flatMap(tokenize)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

/** The share of a channel's titles, 0 to 1, that use each word. */
function titleShares(titles: readonly string[]): Vector {
  const titlesUsing = new Map<string, number>();
  for (const token of titles.flatMap((title) => [...new Set(tokenize(title))])) {
    titlesUsing.set(token, (titlesUsing.get(token) ?? 0) + 1);
  }
  return new Map([...titlesUsing].map(([term, count]) => [term, count / titles.length]));
}

/** Two sets of title shares merged, each counting for the given number of titles. */
function blendShares(own: Vector, ownVotes: number, lent: Vector, lentVotes: number): Vector {
  const terms = new Set([...own.keys(), ...lent.keys()]);
  return new Map(
    [...terms].map((term) => [
      term,
      ((own.get(term) ?? 0) * ownVotes + (lent.get(term) ?? 0) * lentVotes) /
        (ownVotes + lentVotes),
    ]),
  );
}

function documentFrequencies(documents: readonly Vector[]): Vector {
  const frequencies = new Map<string, number>();
  for (const document of documents) {
    for (const term of document.keys()) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    }
  }
  return frequencies;
}

function norm(vector: Vector): number {
  return Math.sqrt([...vector.values()].reduce((sum, weight) => sum + weight * weight, 0));
}

function cosine(a: Vector, b: Vector): number {
  const scale = norm(a) * norm(b);
  if (scale === 0) return 0;
  const dot = [...a].reduce((sum, [term, weight]) => sum + weight * (b.get(term) ?? 0), 0);
  return dot / scale;
}

/**
 * Scores each candidate against a format profile (word → share of reference titles).
 *
 * The two sides are weighted differently on purpose. The profile is linear in
 * the share, which is what separates format from subject. A candidate may have
 * only a handful of titles, too few to tell its own format from its subjects,
 * so every word it uses gets a say and repeats are damped; were its counts
 * linear too, one word it repeats in every title could carry the whole match.
 */
function scoreAgainst(
  profile: Vector,
  candidates: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, number> {
  const candidateCounts = [...candidates].map(([id, titles]) => [id, termCounts(titles)] as const);
  const documents = [profile, ...candidateCounts.map(([, counts]) => counts)];
  const frequencies = documentFrequencies(documents);
  const rarity = (term: string): number =>
    Math.log((documents.length + 1) / ((frequencies.get(term) ?? 0) + 1)) + 1;
  const weigh = (vector: Vector, scale: (value: number) => number): Vector =>
    new Map([...vector].map(([term, value]) => [term, scale(value) * rarity(term)]));
  const reference = weigh(profile, (share) => share);
  const dampedCounts = (counts: Vector): Vector => weigh(counts, (count) => 1 + Math.log(count));
  return new Map(
    candidateCounts.map(([id, counts]) => [id, cosine(reference, dampedCounts(counts))]),
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
  return scoreAgainst(titleShares(centerTitles), candidates);
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
  const ownShares = titleShares(centerTitles);
  const first = scoreAgainst(ownShares, candidates);
  const anchors = [...anchorPool]
    .filter((id) => (first.get(id) ?? 0) > 0)
    .sort((a, b) => (first.get(b) ?? 0) - (first.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, MAX_ANCHORS);
  if (anchors.length === 0) return { scores: first, anchors };
  const lentTitles = anchors.flatMap((id) => candidates.get(id) ?? []);
  const profile = blendShares(
    ownShares,
    centerTitles.length,
    titleShares(lentTitles),
    Math.min(lentTitles.length, MAX_ANCHOR_TITLE_VOTES),
  );
  return { scores: scoreAgainst(profile, candidates), anchors };
}

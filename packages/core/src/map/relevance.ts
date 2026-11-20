/**
 * A cheap first read on whether two channels make the same kind of video:
 * cosine similarity between their title vocabularies, with words that few
 * channels on the map use weighted up.
 *
 * It catches shared title formats ("America Just Built …"). It cannot tell that
 * two channels serve the same audience in different words; a judged pass by a
 * model comes later for that.
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

function termCounts(titles: readonly string[]): Vector {
  const counts = new Map<string, number>();
  for (const token of titles.flatMap(tokenize)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
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

function weigh(counts: Vector, frequencies: Vector, documentCount: number): Vector {
  return new Map(
    [...counts].map(([term, count]) => {
      const inverseFrequency =
        Math.log((documentCount + 1) / ((frequencies.get(term) ?? 0) + 1)) + 1;
      return [term, (1 + Math.log(count)) * inverseFrequency];
    }),
  );
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

/** Title similarity of each candidate to the centre, from 0 (nothing shared) to 1 (same vocabulary). */
export function titleSimilarity(
  centerTitles: readonly string[],
  candidates: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, number> {
  const centerCounts = termCounts(centerTitles);
  const candidateCounts = [...candidates].map(([id, titles]) => [id, termCounts(titles)] as const);
  const documents = [centerCounts, ...candidateCounts.map(([, counts]) => counts)];
  const frequencies = documentFrequencies(documents);
  const center = weigh(centerCounts, frequencies, documents.length);
  return new Map(
    candidateCounts.map(([id, counts]) => [
      id,
      cosine(center, weigh(counts, frequencies, documents.length)),
    ]),
  );
}

/** How many of the closest look-alikes join the centre as the reference for the second pass. */
export const MAX_ANCHORS = 3;

export interface AnchoredSimilarity {
  readonly scores: ReadonlyMap<string, number>;
  /** The look-alikes whose titles were added to the centre's as the reference. */
  readonly anchors: readonly string[];
}

/**
 * Title similarity when the centre has too few videos to describe its niche.
 *
 * A first pass scores every candidate against the centre alone. The best few
 * from `anchorPool` (channels that could plausibly be peers) then lend their
 * titles to the centre, and a second pass scores everyone against that larger
 * reference. With three titles the first pass barely separates a look-alike
 * (12%) from a news network (2%); the second separates them clearly.
 */
export function anchoredTitleSimilarity(
  centerTitles: readonly string[],
  candidates: ReadonlyMap<string, readonly string[]>,
  anchorPool: readonly string[],
): AnchoredSimilarity {
  const first = titleSimilarity(centerTitles, candidates);
  const anchors = [...anchorPool]
    .filter((id) => (first.get(id) ?? 0) > 0)
    .sort((a, b) => (first.get(b) ?? 0) - (first.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, MAX_ANCHORS);
  if (anchors.length === 0) return { scores: first, anchors };
  const reference = [...centerTitles, ...anchors.flatMap((id) => candidates.get(id) ?? [])];
  return { scores: titleSimilarity(reference, candidates), anchors };
}

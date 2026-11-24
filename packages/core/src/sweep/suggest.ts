/**
 * Keywords offered for the watchlist, worked out in code from the channels on
 * the owner's maps: the topic labels those channels carry, and the title
 * words their winners share. A word must be in winners of at least two
 * channels, so nothing is fitted to one channel, and must be more common
 * among winners than among all titles. The owner chooses; nothing is added
 * unasked.
 */
import { topicQuery } from '../bank/cost';
import { tokenize } from '../map/relevance';
import { NICHE_MIN_OUTLIER_SCORE } from '../niches/outperform';
import { OTHER_TOPIC } from '../niches/topic';

/** A winner is a video at or past the multiple the niche rule asks for. */
export const SUGGEST_MIN_SCORE = NICHE_MIN_OUTLIER_SCORE;
export const SUGGEST_MIN_CHANNELS = 2;
export const SUGGEST_TOPICS_SHOWN = 3;
export const SUGGEST_WORDS_SHOWN = 6;

export interface SuggestChannel {
  /** The channel's topic label. */
  readonly topic: string;
  readonly videos: readonly { readonly title: string; readonly score: number | null }[];
}

export interface SuggestInput {
  /** The channels on the owner's maps. */
  readonly channels: readonly SuggestChannel[];
  /** The keywords already on the watchlist. */
  readonly kept: readonly string[];
}

export interface KeywordSuggestion {
  readonly keyword: string;
  readonly from: 'topic' | 'titles';
  /** How many of the maps' channels it comes from. */
  readonly channels: number;
}

const countBy = (keys: readonly string[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
};

const mostFirst = (counts: ReadonlyMap<string, number>): readonly (readonly [string, number])[] =>
  [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

function topics(channels: readonly SuggestChannel[]): readonly KeywordSuggestion[] {
  const labels = channels.map((one) => one.topic).filter((label) => label !== OTHER_TOPIC);
  return mostFirst(countBy(labels))
    .slice(0, SUGGEST_TOPICS_SHOWN)
    .map(([label, count]) => ({ keyword: topicQuery(label), from: 'topic', channels: count }));
}

const isWinner = (video: { readonly score: number | null }): boolean =>
  video.score !== null && video.score >= SUGGEST_MIN_SCORE;

/** The distinct words of some titles. */
const wordsOf = (titles: readonly string[]): readonly string[] => [
  ...new Set(titles.flatMap((title) => tokenize(title))),
];

/** Words in winners of two channels or more, and in fewer non-winners' channels than winners'. */
function winnerWords(channels: readonly SuggestChannel[]): readonly KeywordSuggestion[] {
  const titles = (pick: (video: SuggestChannel['videos'][number]) => boolean) =>
    countBy(
      channels.flatMap((one) => wordsOf(one.videos.filter(pick).map((video) => video.title))),
    );
  const inWinners = titles(isWinner);
  const inOthers = titles((video) => !isWinner(video));
  return mostFirst(inWinners)
    .filter(([, count]) => count >= SUGGEST_MIN_CHANNELS)
    .map(([word, count]) => ({ word, count, others: inOthers.get(word) ?? 0 }))
    .filter((one) => one.count > one.others)
    .sort((a, b) => b.count - b.others - (a.count - a.others))
    .slice(0, SUGGEST_WORDS_SHOWN)
    .map((one) => ({ keyword: one.word, from: 'titles', channels: one.count }));
}

/** Topic labels first, then winners' words; nothing the watchlist already holds. */
export function suggestKeywords(input: SuggestInput): readonly KeywordSuggestion[] {
  const kept = new Set(input.kept.map((keyword) => keyword.toLowerCase()));
  return [...topics(input.channels), ...winnerWords(input.channels)].filter(
    (one) => !kept.has(one.keyword.toLowerCase()),
  );
}

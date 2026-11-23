/**
 * What a listed channel is about, as one short label from a fixed table, so
 * New niches can be filtered by subject. Nothing here is judged by a model:
 * the label comes from words, in this order, the channel's own keywords and
 * description (its stored brand read), then its titles. The store keeps no
 * YouTube video category, so that source is not available.
 *
 * TODO: a judged reading (an engine naming each channel's subject from its
 * titles) would label far more channels than a word table can, and name
 * subjects the table does not know. It is not run here: this view reads the
 * store only.
 */
import { tokenize } from '../map/relevance';

/** Where a channel's label came from. 'none': nothing pointed anywhere, so it is Other. */
export type TopicSource = 'keywords' | 'titles' | 'none';

export interface NicheTopic {
  readonly label: string;
  readonly source: TopicSource;
}

export interface TopicInput {
  readonly id: string;
  readonly titles: readonly string[];
  /** The channel's own keywords and description; null when its page was never read. */
  readonly brand: {
    readonly keywords: readonly string[];
    readonly description: string | null;
  } | null;
}

/** The label for a channel no topic fits clearly. */
export const OTHER_TOPIC = 'Other';
/** Fewer word hits than this is a passing mention, not what the channel is about. */
export const TOPIC_MIN_HITS = 2;

/** A table row's words, written as one line of text. */
const words = (line: string): readonly string[] => line.split(' ');

/**
 * The topics and the words that point to each, singular and lower case. A word
 * belongs to one topic only; words that could be read several ways ("electric",
 * "world", "new") are left out on purpose.
 */
export const NICHE_TOPICS: readonly {
  readonly label: string;
  readonly words: readonly string[];
}[] = [
  {
    label: 'Engineering & inventions',
    words: words(
      'engineer engineering invention invent inventor megaproject construction infrastructure bridge tunnel dam skyscraper factory machine railway train airport solar energy nuclear battery',
    ),
  },
  {
    label: 'Science & space',
    words: words(
      'space nasa spacex rocket mars moon planet galaxy universe physics science scientist astronomy chemistry biology quantum asteroid',
    ),
  },
  {
    label: 'Geopolitics',
    words: words(
      'war china russia ukraine nato trump putin iran israel president election geopolitics government sanction news politics political europe tariff',
    ),
  },
  {
    label: 'Military',
    words: words(
      'military army navy tank missile weapon fighter jet drone submarine soldier warship carrier',
    ),
  },
  {
    label: 'Cars',
    words: words(
      'car tesla vehicle ev truck engine bmw toyota ford porsche ferrari motor cybertruck suv automotive',
    ),
  },
  {
    label: 'History',
    words: words(
      'history historical ancient empire medieval roman rome egypt pharaoh castle king queen century civilization ww2 wwii',
    ),
  },
  {
    label: 'Finance',
    words: words(
      'money stock investing invest investor economy economic finance financial market bitcoin crypto bank billion crash recession inflation tax rich wealth business',
    ),
  },
  {
    label: 'Tech & AI',
    words: words(
      'ai robot chip apple iphone computer software tech technology gadget smartphone google nvidia openai chatgpt',
    ),
  },
  {
    label: 'Mysteries & crime',
    words: words(
      'mystery mysterious crime murder unsolved disappeared killer detective conspiracy',
    ),
  },
  {
    label: 'Gaming',
    words: words('game gaming minecraft fortnite roblox gta playstation xbox nintendo'),
  },
  {
    label: 'Food & health',
    words: words('food recipe cooking health diet doctor fitness workout'),
  },
  {
    label: 'Nature & animals',
    words: words('animal wildlife nature ocean shark dog cat bird'),
  },
  {
    label: 'Travel & places',
    words: words('travel city country village island tourist'),
  },
];

const TOPIC_OF: ReadonlyMap<string, string> = new Map(
  NICHE_TOPICS.flatMap((topic) => topic.words.map((word) => [word, topic.label] as const)),
);

/** The topic a word points to, reading a plural as its word. */
function topicOfWord(word: string): string | undefined {
  return TOPIC_OF.get(word) ?? (word.endsWith('s') ? TOPIC_OF.get(word.slice(0, -1)) : undefined);
}

/**
 * The topic the words point to most, each occurrence counted at its weight;
 * null when fewer than `TOPIC_MIN_HITS` words hit or two topics tie at the top.
 */
export function topicFromWords(
  words: readonly string[],
  weightOf: (word: string) => number,
): string | null {
  const scores = new Map<string, number>();
  let hits = 0;
  for (const word of words) {
    const topic = topicOfWord(word);
    if (topic === undefined) continue;
    hits += 1;
    scores.set(topic, (scores.get(topic) ?? 0) + weightOf(word));
  }
  if (hits < TOPIC_MIN_HITS) return null;
  const [first, second] = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (first === undefined || (second !== undefined && second[1] === first[1])) return null;
  return first[0];
}

/** The words of a channel's own keywords and description. */
function brandWords(brand: TopicInput['brand']): readonly string[] {
  if (brand === null) return [];
  return [...brand.keywords, brand.description ?? ''].flatMap((text) => tokenize(text));
}

/**
 * How rare each title word is across the channels being labelled, as the title
 * match weighs it: ln((channels + 1) / (channels using it + 1)) + 1. A word every
 * channel uses says little about any one of them.
 */
function rarityAcross(words: readonly (readonly string[])[]): (word: string) => number {
  const usedBy = new Map<string, number>();
  for (const one of words) {
    for (const word of new Set(one)) usedBy.set(word, (usedBy.get(word) ?? 0) + 1);
  }
  const documents = words.length;
  return (word) => Math.log((documents + 1) / ((usedBy.get(word) ?? 0) + 1)) + 1;
}

/** Each channel's topic, from its keywords when they point somewhere, else from its titles. */
export function assignTopics(inputs: readonly TopicInput[]): ReadonlyMap<string, NicheTopic> {
  const titleWords = inputs.map((one) => one.titles.flatMap((title) => tokenize(title)));
  const rarity = rarityAcross(titleWords);
  return new Map(
    inputs.map((one, at): [string, NicheTopic] => {
      const fromBrand = topicFromWords(brandWords(one.brand), () => 1);
      if (fromBrand !== null) return [one.id, { label: fromBrand, source: 'keywords' }];
      const fromTitles = topicFromWords(titleWords[at] ?? [], rarity);
      if (fromTitles !== null) return [one.id, { label: fromTitles, source: 'titles' }];
      return [one.id, { label: OTHER_TOPIC, source: 'none' }];
    }),
  );
}

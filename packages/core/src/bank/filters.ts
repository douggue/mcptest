/**
 * The outlier bank's filter groups: what each offers and which options a
 * video falls in. A video passes a group when it is in any option chosen
 * there, and passes the filters when it passes every group in use, as on
 * New niches. Pure: the web app imports this file (never the core index).
 */
import type { BankVideo } from './types';

export type BankGroupId =
  | 'score'
  | 'views'
  | 'age'
  | 'length'
  | 'size'
  | 'topic'
  | 'language'
  | 'country'
  | 'money'
  | 'source'
  | 'collection';

export interface BankOption {
  readonly key: string;
  readonly label: string;
}

/** What a filter needs besides the video: the collections each video is in. */
export interface BankFilterContext {
  readonly collectionsOf: (videoId: string) => readonly number[];
  /** Names of the owner's collections, by id, for the options' labels. */
  readonly collectionNames: ReadonlyMap<number, string>;
}

export interface BankGroup {
  readonly id: BankGroupId;
  readonly label: string;
  /** One line saying where the numbers come from. */
  readonly note: string;
  /** One option at a time: a lowest multiple, a window of days. */
  readonly single?: boolean;
  /** The options always offered; absent when they are the values found in the bank. */
  readonly options?: readonly BankOption[];
  readonly keysOf: (video: BankVideo, context: BankFilterContext) => readonly string[];
}

/** The lowest multiples offered; a video is in every one its score reaches. */
export const BANK_SCORE_STEPS: readonly number[] = [2, 5, 10, 50, 100];
/** The windows of days offered for a video's age. */
export const BANK_AGE_WINDOWS: readonly number[] = [7, 30, 90, 365];
const MINUTE = 60;
/** The line between short and medium long videos, and between medium and long, in minutes. */
export const BANK_LENGTH_LINES = { short: 8, long: 20 } as const;

const one = (key: string): readonly string[] => [key];

function viewsKey(views: number): string {
  if (views < 10_000) return 'under-10k';
  if (views < 100_000) return '10k-100k';
  if (views < 1_000_000) return '100k-1m';
  return '1m-plus';
}

function lengthKey(video: BankVideo): string {
  if (video.durationSeconds === null) return 'unknown';
  if (video.isShort) return 'shorts';
  const minutes = video.durationSeconds / MINUTE;
  if (minutes < BANK_LENGTH_LINES.short) return 'under-8';
  return minutes < BANK_LENGTH_LINES.long ? '8-20' : '20-plus';
}

function sizeKey(subscribers: number | null): string {
  if (subscribers === null) return 'hidden';
  if (subscribers < 1000) return 'under-1k';
  if (subscribers < 10_000) return '1k-10k';
  if (subscribers < 100_000) return '10k-100k';
  return subscribers < 1_000_000 ? '100k-1m' : '1m-plus';
}

export const collectionKey = (id: number): string => `c${id}`;

export const BANK_GROUPS: readonly BankGroup[] = [
  {
    id: 'score',
    label: 'Outlier score',
    note: 'Views over the channel’s usual at the same age, from stored videos.',
    single: true,
    options: BANK_SCORE_STEPS.map((step) => ({ key: String(step), label: `${step}× or more` })),
    keysOf: (video) =>
      video.score === null
        ? []
        : BANK_SCORE_STEPS.filter((step) => (video.score ?? 0) >= step).map(String),
  },
  {
    id: 'views',
    label: 'Views',
    note: 'Views when the video was last read.',
    options: [
      { key: 'under-10k', label: 'Under 10K' },
      { key: '10k-100k', label: '10K–100K' },
      { key: '100k-1m', label: '100K–1M' },
      { key: '1m-plus', label: '1M+' },
    ],
    keysOf: (video) => one(viewsKey(video.views)),
  },
  {
    id: 'age',
    label: 'Age',
    note: 'Days since upload, as exact as YouTube said.',
    single: true,
    options: BANK_AGE_WINDOWS.map((days) => ({ key: String(days), label: `Last ${days} days` })),
    keysOf: (video) =>
      BANK_AGE_WINDOWS.filter((days) => video.ageDays <= days).map((days) => String(days)),
  },
  {
    id: 'length',
    label: 'Length',
    note: 'Shorts are a minute or less, the line the earnings estimate draws.',
    options: [
      { key: 'shorts', label: 'Shorts' },
      { key: 'under-8', label: 'Under 8 min' },
      { key: '8-20', label: '8–20 min' },
      { key: '20-plus', label: '20+ min' },
      { key: 'unknown', label: 'Not known' },
    ],
    keysOf: (video) => one(lengthKey(video)),
  },
  {
    id: 'size',
    label: 'Channel size',
    note: 'Subscribers when the channel was last read.',
    options: [
      { key: 'under-1k', label: 'Under 1K' },
      { key: '1k-10k', label: '1K–10K' },
      { key: '10k-100k', label: '10K–100K' },
      { key: '100k-1m', label: '100K–1M' },
      { key: '1m-plus', label: '1M+' },
      { key: 'hidden', label: 'Hidden' },
    ],
    keysOf: (video) => one(sizeKey(video.channel.subscribers)),
  },
  {
    id: 'topic',
    label: 'Niche',
    note: 'From the channel’s own keywords, else its titles, by a fixed word table.',
    keysOf: (video) => one(video.channel.topic.label),
  },
  {
    id: 'language',
    label: 'Language',
    note: 'Told by the alphabet of the channel’s titles; nothing is translated.',
    keysOf: (video) => one(video.channel.alphabet),
  },
  {
    id: 'country',
    label: 'Country',
    note: 'The country the channel set, from the official API when it was asked.',
    keysOf: (video) => one(video.channel.country ?? 'unknown'),
  },
  {
    id: 'money',
    label: 'Monetized',
    note: 'Public signs read on request; never a yes or no from YouTube.',
    options: [
      { key: 'monetized', label: 'Monetized (Join button)' },
      { key: 'likely', label: 'Likely (ads shown)' },
      { key: 'not-yet', label: 'Not yet' },
      { key: 'no-sign', label: 'No sign' },
      { key: 'not-checked', label: 'Not checked' },
    ],
    keysOf: (video) => one(video.channel.money),
  },
  {
    id: 'source',
    label: 'Source',
    note: 'Whether one of your maps holds the channel.',
    options: [
      { key: 'maps', label: 'On my maps' },
      { key: 'elsewhere', label: 'Elsewhere (niches, pasted, searches)' },
    ],
    keysOf: (video) => one(video.channel.onAMap ? 'maps' : 'elsewhere'),
  },
  {
    id: 'collection',
    label: 'Collections',
    note: 'Your own collections of saved outliers.',
    keysOf: (video, context) => context.collectionsOf(video.videoId).map(collectionKey),
  },
];

export const BANK_GROUP_IDS: readonly BankGroupId[] = BANK_GROUPS.map((group) => group.id);

const ALPHABET_LABELS: Readonly<Record<string, string>> = {
  latin: 'Latin letters',
  other: 'Another alphabet',
};

let countryNames: Intl.DisplayNames | null = null;

function countryLabel(code: string): string {
  if (code === 'unknown') return 'Not known';
  try {
    countryNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The label of an option whose key is a value found in the bank. */
export function optionLabel(
  group: BankGroupId,
  key: string,
  context: Pick<BankFilterContext, 'collectionNames'>,
): string {
  if (group === 'language') return ALPHABET_LABELS[key] ?? key;
  if (group === 'country') return countryLabel(key);
  if (group === 'collection') {
    return context.collectionNames.get(Number(key.slice(1))) ?? 'A collection';
  }
  return (
    BANK_GROUPS.find((one) => one.id === group)?.options?.find((o) => o.key === key)?.label ?? key
  );
}

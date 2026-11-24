/**
 * One look at the outlier bank: the filters chosen, the title words, the
 * order and the page. Worked out over the built bank in memory; nothing is
 * asked of YouTube. Pure, so the web app can import it for the shapes.
 */
import {
  BANK_GROUPS,
  BANK_GROUP_IDS,
  optionLabel,
  type BankFilterContext,
  type BankGroup,
  type BankGroupId,
} from './filters';
import type { BankVideo } from './types';

export type BankSort = 'score' | 'views' | 'newest' | 'pace';

export const BANK_SORTS: readonly { readonly id: BankSort; readonly label: string }[] = [
  { id: 'score', label: 'Highest ×' },
  { id: 'views', label: 'Most views' },
  { id: 'newest', label: 'Newest' },
  { id: 'pace', label: 'Most views a day' },
];

export interface BankFilterState {
  readonly chosen: Readonly<Record<BankGroupId, readonly string[]>>;
  /** Words every title kept must hold, separated by spaces. */
  readonly contains: string;
  /** Words no title kept may hold. */
  readonly excludes: string;
  readonly sort: BankSort;
}

export const NO_BANK_FILTERS: BankFilterState = {
  chosen: Object.fromEntries(BANK_GROUP_IDS.map((id) => [id, []])) as unknown as Record<
    BankGroupId,
    readonly string[]
  >,
  contains: '',
  excludes: '',
  sort: 'score',
};

export interface BankOptionCount {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

export interface BankPage {
  /** Every video in the bank. */
  readonly total: number;
  /** The videos the filters keep. */
  readonly matched: number;
  readonly offset: number;
  readonly limit: number;
  readonly videos: readonly BankVideo[];
  readonly options: Readonly<Record<BankGroupId, readonly BankOptionCount[]>>;
}

export const BANK_DEFAULT_PAGE = 24;
export const BANK_MAX_PAGE = 100;
/** Longer than any option key the page writes: a topic, an alphabet, a country, a collection. */
const MAX_KEY_LENGTH = 40;
const MAX_KEYS = 50;
export const BANK_MAX_WORDS_LENGTH = 100;

export const isBankSort = (value: unknown): value is BankSort =>
  BANK_SORTS.some((sort) => sort.id === value);

/** The state with one group's choice replaced. */
export function withChoice(
  state: BankFilterState,
  group: BankGroupId,
  keys: readonly string[],
): BankFilterState {
  return { ...state, chosen: { ...state.chosen, [group]: keys } };
}

const wordsOf = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');

function wordsPass(video: BankVideo, state: BankFilterState): boolean {
  const title = video.title.toLowerCase();
  return (
    wordsOf(state.contains).every((word) => title.includes(word)) &&
    !wordsOf(state.excludes).some((word) => title.includes(word))
  );
}

/** One video's options in every group, worked out once per look. */
type Keyed = Readonly<Record<BankGroupId, readonly string[]>>;

function keyed(video: BankVideo, context: BankFilterContext): Keyed {
  return Object.fromEntries(
    BANK_GROUPS.map((group) => [group.id, group.keysOf(video, context)]),
  ) as unknown as Keyed;
}

/** The groups a video fails, given what is chosen; empty when it passes them all. */
function failedGroups(keys: Keyed, state: BankFilterState): readonly BankGroupId[] {
  return BANK_GROUP_IDS.filter((id) => {
    const chosen = state.chosen[id];
    return chosen.length > 0 && !chosen.some((key) => keys[id].includes(key));
  });
}

interface Tally {
  readonly matching: readonly BankVideo[];
  /** Per group, how many videos each option would keep given the other groups. */
  readonly counts: ReadonlyMap<BankGroupId, ReadonlyMap<string, number>>;
  /** Per group whose options are the values found, every value with how many videos hold it. */
  readonly found: ReadonlyMap<BankGroupId, ReadonlyMap<string, number>>;
}

function bump(
  table: Map<BankGroupId, Map<string, number>>,
  id: BankGroupId,
  keys: readonly string[],
) {
  const counts = table.get(id) ?? new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  table.set(id, counts);
}

/**
 * One pass over the bank: which videos the filters keep, and each option's
 * count. A video that fails no group counts in every group; one that fails a
 * single group counts in that group only, since choosing there could keep it.
 */
function tally(
  videos: readonly BankVideo[],
  state: BankFilterState,
  context: BankFilterContext,
): Tally {
  const matching: BankVideo[] = [];
  const counts = new Map<BankGroupId, Map<string, number>>();
  const found = new Map<BankGroupId, Map<string, number>>();
  for (const video of videos) {
    const keys = keyed(video, context);
    for (const group of BANK_GROUPS) if (!group.options) bump(found, group.id, keys[group.id]);
    if (!wordsPass(video, state)) continue;
    const failed = failedGroups(keys, state);
    if (failed.length === 0) {
      matching.push(video);
      for (const id of BANK_GROUP_IDS) bump(counts, id, keys[id]);
    } else if (failed.length === 1 && failed[0] !== undefined) {
      bump(counts, failed[0], keys[failed[0]]);
    }
  }
  return { matching, counts, found };
}

const SORTS: Readonly<Record<BankSort, (a: BankVideo, b: BankVideo) => number>> = {
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || b.views - a.views,
  views: (a, b) => b.views - a.views,
  newest: (a, b) => a.ageDays - b.ageDays,
  pace: (a, b) => b.viewsPerDay - a.viewsPerDay,
};

const LAST_KEYS: ReadonlySet<string> = new Set(['Other', 'unknown', 'other']);

/** The values found for a group whose options are not fixed, in the order the page lists them. */
function foundKeys(
  group: BankGroup,
  found: ReadonlyMap<string, number> | undefined,
  context: BankFilterContext,
): readonly string[] {
  if (group.id === 'collection') return [...context.collectionNames.keys()].map((id) => `c${id}`);
  const rank = (key: string) => (key === 'latin' ? -1 : LAST_KEYS.has(key) ? 1 : 0);
  return [...(found ?? new Map<string, number>()).entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}

function groupOptions(
  group: BankGroup,
  counted: Tally,
  context: BankFilterContext,
): readonly BankOptionCount[] {
  const counts = counted.counts.get(group.id);
  const keys =
    group.options?.map((option) => option.key) ??
    foundKeys(group, counted.found.get(group.id), context);
  return keys.map((key) => ({
    key,
    label: optionLabel(group.id, key, context),
    count: counts?.get(key) ?? 0,
  }));
}

/** What the filters keep, in the order asked, one page of it, and each option's count. */
export function queryBank(
  videos: readonly BankVideo[],
  state: BankFilterState,
  context: BankFilterContext,
  page: { readonly offset: number; readonly limit: number } = {
    offset: 0,
    limit: BANK_DEFAULT_PAGE,
  },
): BankPage {
  const counted = tally(videos, state, context);
  const { matching } = counted;
  const sorted = [...matching].sort(
    (a, b) => SORTS[state.sort](a, b) || a.videoId.localeCompare(b.videoId),
  );
  const offset = Math.max(0, Math.floor(page.offset));
  const limit = Math.min(BANK_MAX_PAGE, Math.max(1, Math.floor(page.limit)));
  return {
    total: videos.length,
    matched: matching.length,
    offset,
    limit,
    videos: sorted.slice(offset, offset + limit),
    options: Object.fromEntries(
      BANK_GROUPS.map((group) => [group.id, groupOptions(group, counted, context)]),
    ) as unknown as BankPage['options'],
  };
}

/** The keys of one group that the page could have written. */
function cleanKeys(group: BankGroup, raw: string | null): readonly string[] {
  if (raw === null || raw === '') return [];
  const allowed = group.options?.map((option) => option.key);
  const keys = raw
    .split(',')
    .filter((key) => key !== '' && key.length <= MAX_KEY_LENGTH)
    .filter((key) => (allowed ? allowed.includes(key) : true))
    .slice(0, MAX_KEYS);
  const unique = [...new Set(keys)];
  return group.single ? unique.slice(-1) : unique;
}

const cleanWords = (raw: string | null): string =>
  (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, BANK_MAX_WORDS_LENGTH);

/** The state an address holds; anything that is not a known option is dropped. */
export function parseBankQuery(params: URLSearchParams): BankFilterState {
  const sort = params.get('sort');
  return {
    chosen: Object.fromEntries(
      BANK_GROUPS.map((group) => [group.id, cleanKeys(group, params.get(group.id))]),
    ) as unknown as BankFilterState['chosen'],
    contains: cleanWords(params.get('contains')),
    excludes: cleanWords(params.get('excludes')),
    sort: isBankSort(sort) ? sort : NO_BANK_FILTERS.sort,
  };
}

/** The state as an address's query, leaving out what is not in use. */
export function bankQueryParams(state: BankFilterState): Record<string, string> {
  const groups = BANK_GROUPS.flatMap((group) => {
    const keys = state.chosen[group.id];
    return keys.length > 0 ? [[group.id, keys.join(',')] as const] : [];
  });
  return Object.fromEntries([
    ...groups,
    ...(state.contains !== '' ? [['contains', state.contains] as const] : []),
    ...(state.excludes !== '' ? [['excludes', state.excludes] as const] : []),
    ['sort', state.sort],
  ]);
}

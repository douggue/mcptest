/**
 * Discover › Videos: one grid, and the saved views over it. A view is a
 * source and a set of filters: the map's breakouts (Breaking out, 100× and
 * up, Small channels), the bank of every stored video (All-time bank, each
 * collection), the same idea in other languages, the videos studied, and
 * the views the owner saved. The breakout views give exactly what the old
 * Breaking out list gave under its four filters; the bank views are the old
 * Outlier bank under its filters.
 */
import type { BankCollection, BankVideo, BreakoutVideo } from '@jgtube/core';
import type { BankFilterState } from '@jgtube/core/src/bank/query';
import { parseSavedBank, savedBankText, toggleBankChoice } from './bank';
import { describeEvidence, filterBreakouts, type BreakoutFilter } from './feed';
import { formatAge, formatCount, formatScore } from './format';
import { scoreBasis } from './videoPage';

/** How high a breakout's score must be to show. */
export type ScoreFloor = 'any' | '50' | '100';

/** The filters over the map's breakouts: the old list's, as separate choices, and title words. */
export interface MapFilters {
  readonly score: ScoreFloor;
  /** Only channels under 10K subscribers. */
  readonly small: boolean;
  /** Words every title kept must hold. */
  readonly words: string;
}

export const NO_MAP_FILTERS: MapFilters = { score: 'any', small: false, words: '' };

export const SCORE_FLOORS: readonly { readonly id: ScoreFloor; readonly label: string }[] = [
  { id: 'any', label: 'Any score' },
  { id: '50', label: '50× and up' },
  { id: '100', label: '100× and up' },
];

const FLOOR_FILTER: Readonly<Record<ScoreFloor, BreakoutFilter>> = {
  any: 'all',
  '50': '50x',
  '100': '100x',
};

/** The filters each choice of the old Breaking out list stands for. */
export const OLD_BREAKOUT_FILTERS: Readonly<Record<BreakoutFilter, MapFilters>> = {
  all: NO_MAP_FILTERS,
  '100x': { ...NO_MAP_FILTERS, score: '100' },
  '50x': { ...NO_MAP_FILTERS, score: '50' },
  small: { ...NO_MAP_FILTERS, small: true },
};

const wordsOf = (text: string): readonly string[] =>
  text.toLowerCase().split(/\s+/).filter(Boolean);

/** The breakouts the filters keep, in the order given: the old list's own filters, one after another. */
export function applyMapFilters<T extends BreakoutVideo>(
  items: readonly T[],
  filters: MapFilters,
): readonly T[] {
  const scored = filterBreakouts(items, FLOOR_FILTER[filters.score]);
  const sized = filters.small ? filterBreakouts(scored, 'small') : scored;
  const words = wordsOf(filters.words);
  if (words.length === 0) return sized;
  return sized.filter((item) => {
    const title = item.title.toLowerCase();
    return words.every((word) => title.includes(word));
  });
}

/** How many of the map's filters are in use. */
export const activeMapFilters = (filters: MapFilters): number =>
  Number(filters.score !== 'any') + Number(filters.small) + Number(filters.words.trim() !== '');

/** A view the owner saved: a name over a source and its filters. */
export type OwnView =
  | { readonly name: string; readonly source: 'map'; readonly filters: MapFilters }
  | { readonly name: string; readonly source: 'bank'; readonly filters: BankFilterState };

export const OWN_VIEWS_KEY = 'jgtube.videoViews.v1';
export const MAX_VIEW_NAME = 40;
export const MAX_OWN_VIEWS = 12;

/** The part of an address that names an own view. */
export const viewSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_VIEW_NAME) || 'view';

/** Why a name cannot be used for a new view, or null when it can. */
export function viewNameProblem(name: string, views: readonly OwnView[]): string | null {
  const wanted = name.trim();
  if (wanted === '') return 'Give the view a name.';
  if (wanted.length > MAX_VIEW_NAME) return `A name can be at most ${MAX_VIEW_NAME} characters.`;
  if (views.length >= MAX_OWN_VIEWS)
    return `You can keep ${MAX_OWN_VIEWS} views. Remove one first.`;
  return views.some((view) => viewSlug(view.name) === viewSlug(wanted))
    ? 'You already have a view of that name.'
    : null;
}

const isFloor = (value: unknown): value is ScoreFloor =>
  value === 'any' || value === '50' || value === '100';

function mapFiltersFrom(raw: unknown): MapFilters {
  const given = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    score: isFloor(given['score']) ? given['score'] : 'any',
    small: given['small'] === true,
    words: typeof given['words'] === 'string' ? given['words'].slice(0, 100) : '',
  };
}

function ownViewFrom(raw: unknown): OwnView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { name, source, filters } = raw as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_VIEW_NAME) return null;
  if (source === 'map') return { name, source, filters: mapFiltersFrom(filters) };
  if (source !== 'bank') return null;
  // The bank's filters are kept as the text the bank itself writes, and read back through its own checks.
  return { name, source, filters: parseSavedBank(typeof filters === 'string' ? filters : null) };
}

/** The views kept in this browser, read back with every field checked; none when unreadable. */
export function parseOwnViews(text: string | null): readonly OwnView[] {
  if (text === null) return [];
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((one) => ownViewFrom(one) ?? []).slice(0, MAX_OWN_VIEWS);
  } catch {
    return [];
  }
}

/** The views as they are kept in this browser. */
export const ownViewsText = (views: readonly OwnView[]): string =>
  JSON.stringify(
    views.map((view) =>
      view.source === 'bank' ? { ...view, filters: savedBankText(view.filters) } : view,
    ),
  );

/** One pill of the views row. */
export interface ViewPill {
  /** What the address carries after `discover/videos`; empty for the first view. */
  readonly key: string;
  readonly label: string;
  /** How many videos it holds, when that is known. */
  readonly count?: string;
}

export interface ViewCounts {
  /** The map's breakouts in scope; null with no map. */
  readonly breakouts: readonly BreakoutVideo[] | null;
  /** Every stored video; null until the bank has been read. */
  readonly bankTotal: number | null;
  readonly collections: readonly BankCollection[];
  readonly own: readonly OwnView[];
  /** Ideas found in other languages; null until read. */
  readonly transfers: number | null;
  /** Videos taken apart; null until read. */
  readonly studied: number | null;
}

const count = (value: number | null | undefined): { readonly count?: string } =>
  value === null || value === undefined ? {} : { count: value.toLocaleString('en') };

/** The key of a collection among the bank's filter options, as the bank writes it. */
export const collectionOption = (id: number): string => `c${id}`;

/** The address part of a collection's view, and of an own view. */
export const collectionKey = (id: number): string => `collection/${id}`;
export const ownKey = (view: OwnView): string => `saved/${viewSlug(view.name)}`;

/** The views row, in order: the built-in views, the owner's collections, then the owner's own views. */
export function viewPills(counts: ViewCounts): readonly ViewPill[] {
  const { breakouts } = counts;
  const held = (filters: MapFilters): number | null =>
    breakouts === null ? null : applyMapFilters(breakouts, filters).length;
  return [
    { key: '', label: 'Breaking out', ...count(held(NO_MAP_FILTERS)) },
    { key: 'bank', label: 'All-time bank', ...count(counts.bankTotal) },
    { key: '100x', label: '100× and up', ...count(held(OLD_BREAKOUT_FILTERS['100x'])) },
    { key: 'small-channels', label: 'Small channels', ...count(held(OLD_BREAKOUT_FILTERS.small)) },
    { key: 'other-languages', label: 'Other languages', ...count(counts.transfers) },
    ...counts.collections.map((one) => ({
      key: collectionKey(one.id),
      label: one.name,
      ...count(one.count),
    })),
    ...counts.own.map((view) => ({ key: ownKey(view), label: view.name })),
    { key: 'studied', label: 'Studied', ...count(counts.studied) },
  ];
}

/** What a view shows: a source with the filters it starts from. */
export type ViewSource =
  | { readonly kind: 'map'; readonly filters: MapFilters; readonly own: OwnView | null }
  | {
      readonly kind: 'bank';
      /** The filters it opens with; null for the bank itself, which remembers its own. */
      readonly filters: BankFilterState | null;
      readonly collectionId: number | null;
      readonly own: OwnView | null;
    }
  | { readonly kind: 'transfers' }
  | { readonly kind: 'studied' }
  /** The address names a collection or a view that is not there. */
  | { readonly kind: 'missing' };

const COLLECTION_KEY = /^collection\/(\d{1,9})$/;

/** What the view an address names shows. */
export function viewSource(
  key: string,
  collections: readonly BankCollection[] | null,
  own: readonly OwnView[],
): ViewSource {
  if (key === '') return { kind: 'map', filters: NO_MAP_FILTERS, own: null };
  if (key === '100x') return { kind: 'map', filters: OLD_BREAKOUT_FILTERS['100x'], own: null };
  if (key === 'small-channels') {
    return { kind: 'map', filters: OLD_BREAKOUT_FILTERS.small, own: null };
  }
  if (key === 'bank') return { kind: 'bank', filters: null, collectionId: null, own: null };
  if (key === 'other-languages') return { kind: 'transfers' };
  if (key === 'studied') return { kind: 'studied' };
  const collection = COLLECTION_KEY.exec(key)?.[1];
  if (collection !== undefined) {
    const id = Number(collection);
    // Until the collections are read the view is taken at its word; a wrong id shows an empty grid.
    if (collections !== null && !collections.some((one) => one.id === id))
      return { kind: 'missing' };
    return {
      kind: 'bank',
      filters: toggleBankChoice(parseSavedBank(null), 'collection', collectionOption(id)),
      collectionId: id,
      own: null,
    };
  }
  const saved = own.find((view) => ownKey(view) === key);
  if (!saved) return { kind: 'missing' };
  return saved.source === 'map'
    ? { kind: 'map', filters: saved.filters, own: saved }
    : { kind: 'bank', filters: saved.filters, collectionId: null, own: saved };
}

/** A video as the grid's card shows it, whichever source it came from. */
export interface GridVideo {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly channelLogoUrl: string | null;
  readonly durationSeconds: number | null;
  /** The score as its badge reads; null when the video has none. */
  readonly score: string | null;
  /** Views and age, after the channel's name. */
  readonly meta: string;
  /** What the score rests on, in one line. */
  readonly why: string;
}

/** A breakout of the map as a card. */
export function gridBreakout(item: BreakoutVideo): GridVideo {
  return {
    videoId: item.videoId,
    title: item.title,
    channelId: item.channelId,
    channelTitle: item.channelTitle,
    channelLogoUrl: null,
    durationSeconds: item.durationSeconds,
    score: formatScore(item.score),
    meta: `${formatCount(item.views)} views · ${item.publishedRaw}`,
    why: describeEvidence(item),
  };
}

/** A stored video of the bank as a card. */
export function gridBankVideo(video: BankVideo): GridVideo {
  return {
    videoId: video.videoId,
    title: video.title,
    channelId: video.channel.id,
    channelTitle: video.channel.title,
    channelLogoUrl: video.channel.logoUrl,
    durationSeconds: video.durationSeconds,
    score: video.score === null ? null : formatScore(video.score),
    meta: `${formatCount(video.views)} views · ${formatAge(video.ageDays)} ago`,
    why: scoreBasis(video),
  };
}

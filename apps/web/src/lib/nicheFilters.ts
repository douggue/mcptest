/**
 * The filters on New niches: which groups there are, what each offers, how
 * many channels each option would keep, and the list they leave. A channel
 * passes a group when it is in any option chosen there, and passes the
 * filters when it passes every group in use. Every state is a new object.
 */
import type { MoneyStatus, NicheChannel } from '@jgtube/core';
import {
  ageKeys,
  countryKey,
  languageKey,
  revenueKey,
  rpmKey,
  sizeKey,
  tookOffKeys,
  uploadsKey,
} from './nicheBuckets';
import { countryName } from './niches';
import { sortNiches, type NicheSort } from './nicheSort';

export type FilterGroupId =
  | 'topic'
  | 'language'
  | 'age'
  | 'revenue'
  | 'rpm'
  | 'money'
  | 'size'
  | 'tookOff'
  | 'uploads'
  | 'country';

export interface NicheFilterState {
  readonly chosen: Readonly<Record<FilterGroupId, readonly string[]>>;
  readonly sort: NicheSort;
}

/** What a filter needs besides the channel: the day, and the monetization verdicts read so far. */
export interface FilterContext {
  readonly now: Date;
  readonly moneyOf: (channelId: string) => MoneyStatus;
}

export interface FilterOption {
  readonly key: string;
  readonly label: string;
}

export interface FilterGroup {
  readonly id: FilterGroupId;
  /** The button's name. */
  readonly label: string;
  /** One line under the group's name, saying where its numbers come from. */
  readonly note: string;
  /** Only one option at a time, such as a lowest multiple. */
  readonly single?: boolean;
  /** The options always offered; absent when they are the values present on the list. */
  readonly options?: readonly FilterOption[];
  readonly keysOf: (channel: NicheChannel, context: FilterContext) => readonly string[];
}

const one = (key: string): readonly string[] => [key];

export const FILTER_GROUPS: readonly FilterGroup[] = [
  {
    id: 'topic',
    label: 'Niche',
    note: 'From the channel’s own keywords, else its titles; hover a card’s tag to see which.',
    keysOf: (channel) => one(channel.topic.label),
  },
  {
    id: 'language',
    label: 'Language',
    note: 'Told by the alphabet of its titles; nothing is translated.',
    keysOf: (channel) => one(languageKey(channel)),
  },
  {
    id: 'age',
    label: 'Age',
    note: 'From the first upload read, or the account date when that is not known.',
    options: [
      { key: 'new', label: 'New (under 3 months)' },
      { key: 'under-6m', label: '3–6 months' },
      { key: 'under-1y', label: '6–12 months' },
      { key: 'older', label: 'Over a year' },
      { key: 'restarted', label: 'Restarted on an older account' },
      { key: 'unknown', label: 'Not known' },
    ],
    keysOf: (channel, context) => ageKeys(channel, context.now),
  },
  {
    id: 'revenue',
    label: 'Revenue',
    note: 'Estimate: what the views on its last 30 days of uploads may be worth, middle of the range.',
    options: [
      { key: 'under-1k', label: 'Under $1K' },
      { key: '1k-3k', label: '$1K–3K' },
      { key: '3k-5k', label: '$3K–5K' },
      { key: '5k-10k', label: '$5K–10K' },
      { key: '10k-plus', label: '$10K+' },
      { key: 'none', label: 'No estimate (no uploads in 30 days)' },
    ],
    keysOf: (channel) => one(revenueKey(channel)),
  },
  {
    id: 'rpm',
    label: 'RPM',
    note: 'Estimate: the dollars per 1,000 views the revenue estimate works out to, middle of the range. It tops out near $5 (long videos, top ad-rate tier).',
    options: [
      { key: 'under-0.5', label: 'Under $0.50 (mostly Shorts)' },
      { key: '0.5-1', label: '$0.50–1' },
      { key: '1-2', label: '$1–2' },
      { key: '2-3', label: '$2–3' },
      { key: '3-plus', label: '$3–5' },
      { key: 'none', label: 'No estimate (no uploads in 30 days)' },
    ],
    keysOf: (channel) => one(rpmKey(channel)),
  },
  {
    id: 'money',
    label: 'Monetized',
    note: 'From public signs read on request; a channel never checked is “Not checked”.',
    options: [
      { key: 'monetized', label: 'Monetized (Join button seen)' },
      { key: 'likely', label: 'Likely (ads shown)' },
      { key: 'not-yet', label: 'Not yet' },
      { key: 'no-sign', label: 'No sign' },
      { key: 'not-checked', label: 'Not checked' },
    ],
    keysOf: (channel, context) => one(context.moneyOf(channel.id)),
  },
  {
    id: 'size',
    label: 'Size',
    note: 'Subscribers as last read.',
    options: [
      { key: 'under-1k', label: 'Under 1K' },
      { key: '1k-10k', label: '1K–10K' },
      { key: '10k-100k', label: '10K–100K' },
      { key: 'hidden', label: 'Count hidden' },
    ],
    keysOf: (channel) => one(sizeKey(channel)),
  },
  {
    id: 'tookOff',
    label: 'Took off',
    note: 'Its best recent video against its usual views.',
    single: true,
    options: [
      { key: '5', label: '5× or more' },
      { key: '10', label: '10× or more' },
      { key: '50', label: '50× or more' },
    ],
    keysOf: (channel) => tookOffKeys(channel),
  },
  {
    id: 'uploads',
    label: 'Uploads',
    note: 'Uploads a week, from the last 30 days.',
    options: [
      { key: 'under-1', label: 'Under 1 a week' },
      { key: '1-3', label: '1–3 a week' },
      { key: '3-7', label: '3–7 a week' },
      { key: '7-plus', label: '7 or more a week' },
    ],
    keysOf: (channel) => one(uploadsKey(channel)),
  },
  {
    id: 'country',
    label: 'Country',
    note: 'The country the owner set, once the official records were asked for.',
    keysOf: (channel) => one(countryKey(channel)),
  },
];

const GROUP_BY_ID = new Map(FILTER_GROUPS.map((group) => [group.id, group]));
const groupOf = (id: FilterGroupId): FilterGroup => GROUP_BY_ID.get(id) as FilterGroup;

export const NO_FILTERS: NicheFilterState = {
  chosen: {
    topic: [],
    language: [],
    age: [],
    revenue: [],
    rpm: [],
    money: [],
    size: [],
    tookOff: [],
    uploads: [],
    country: [],
  },
  sort: 'demand',
};

/** Whether a channel is in any option chosen in the group; true when none is chosen. */
function passesGroup(
  channel: NicheChannel,
  group: FilterGroup,
  chosen: readonly string[],
  context: FilterContext,
): boolean {
  if (chosen.length === 0) return true;
  return group.keysOf(channel, context).some((key) => chosen.includes(key));
}

/** The channels that pass every group in use, less the one left out. */
function passingOthers(
  channels: readonly NicheChannel[],
  state: NicheFilterState,
  context: FilterContext,
  except: FilterGroupId | null,
): readonly NicheChannel[] {
  const inUse = FILTER_GROUPS.filter(
    (group) => group.id !== except && state.chosen[group.id].length > 0,
  );
  return channels.filter((channel) =>
    inUse.every((group) => passesGroup(channel, group, state.chosen[group.id], context)),
  );
}

/** The channels the filters keep, in the chosen order. */
export function applyFilters(
  channels: readonly NicheChannel[],
  state: NicheFilterState,
  context: FilterContext,
): readonly NicheChannel[] {
  return sortNiches(passingOthers(channels, state, context, null), state.sort, context.now);
}

/** How many channels each option of a group would keep, given the other groups' choices. */
export function optionCounts(
  channels: readonly NicheChannel[],
  state: NicheFilterState,
  groupId: FilterGroupId,
  context: FilterContext,
): ReadonlyMap<string, number> {
  const group = groupOf(groupId);
  const counts = new Map<string, number>();
  passingOthers(channels, state, context, groupId).forEach((channel) =>
    group.keysOf(channel, context).forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1)),
  );
  return counts;
}

const LATIN_LABEL = 'Latin letters (English, Spanish, French…)';
const OTHER_SCRIPT_LABEL = 'Another alphabet (not named)';
const UNKNOWN_COUNTRY = 'Not known';
/** The label core gives a channel no topic fits; written here, as the page imports no values from core. */
const OTHER_TOPIC = 'Other';

/** The name an option found on the list is shown by. */
function presentLabel(groupId: FilterGroupId, key: string): string {
  if (groupId === 'country') return key === 'unknown' ? UNKNOWN_COUNTRY : (countryName(key) ?? key);
  if (groupId === 'topic') return key;
  if (key === 'latin') return LATIN_LABEL;
  return key === 'other' ? OTHER_SCRIPT_LABEL : key;
}

/** Where a found option goes: Latin first, unknown and unnamed last, the rest by count. */
function presentRank(key: string): number {
  if (key === 'latin') return 0;
  return key === 'unknown' || key === 'other' || key === OTHER_TOPIC ? 2 : 1;
}

/** The options a group offers: its fixed ones, or the values found on the list, most common first. */
export function groupOptions(
  channels: readonly NicheChannel[],
  groupId: FilterGroupId,
  context: FilterContext,
): readonly FilterOption[] {
  const group = groupOf(groupId);
  if (group.options) return group.options;
  const counts = optionCounts(channels, NO_FILTERS, groupId, context);
  return [...counts.entries()]
    .sort(
      ([a, countA], [b, countB]) =>
        presentRank(a) - presentRank(b) || countB - countA || a.localeCompare(b),
    )
    .map(([key]) => ({ key, label: presentLabel(groupId, key) }));
}

/** The state with one option chosen or let go; a single-choice group keeps one at most. */
export function toggleChoice(
  state: NicheFilterState,
  groupId: FilterGroupId,
  key: string,
): NicheFilterState {
  const current = state.chosen[groupId];
  const without = current.filter((chosen) => chosen !== key);
  const isChosen = without.length !== current.length;
  const single = groupOf(groupId).single === true;
  const next = isChosen ? without : single ? [key] : [...current, key];
  return { ...state, chosen: { ...state.chosen, [groupId]: next } };
}

/** The state with a group's choice replaced. */
export function setChoice(
  state: NicheFilterState,
  groupId: FilterGroupId,
  keys: readonly string[],
): NicheFilterState {
  return { ...state, chosen: { ...state.chosen, [groupId]: keys } };
}

export const withSort = (state: NicheFilterState, sort: NicheSort): NicheFilterState => ({
  ...state,
  sort,
});

/** Every filter let go; the order stays as chosen. */
export const clearFilters = (state: NicheFilterState): NicheFilterState => ({
  ...NO_FILTERS,
  sort: state.sort,
});

/** How many groups are in use. */
export const activeCount = (state: NicheFilterState): number =>
  FILTER_GROUPS.filter((group) => state.chosen[group.id].length > 0).length;

/** The channels the other filters keep whose monetization was never checked. */
export function uncheckedIds(
  channels: readonly NicheChannel[],
  state: NicheFilterState,
  context: FilterContext,
): readonly string[] {
  return passingOthers(channels, state, context, 'money')
    .filter((channel) => context.moneyOf(channel.id) === 'not-checked')
    .map((channel) => channel.id);
}

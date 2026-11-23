/** The orders New niches can be shown in, each from numbers the list already carries. */
import type { NicheChannel } from '@jgtube/core';
import { bestScore, estimateMiddle, rpmOf } from './nicheBuckets';
import { accountAgeDays } from './niches';

export type NicheSort =
  'demand' | 'breakout' | 'newest' | 'views' | 'per-subscriber' | 'revenue' | 'rpm';

export const NICHE_SORTS: readonly { readonly id: NicheSort; readonly label: string }[] = [
  { id: 'demand', label: 'Most 90-day views' },
  { id: 'breakout', label: 'Biggest breakout' },
  { id: 'newest', label: 'Newest' },
  { id: 'views', label: 'Most 30-day views' },
  { id: 'per-subscriber', label: 'Views per subscriber' },
  { id: 'revenue', label: 'Estimated revenue' },
  { id: 'rpm', label: 'Estimated RPM' },
];

/** A number to sort by, highest first; null sorts last. */
type Measure = (channel: NicheChannel, now: Date) => number | null;

const MEASURES: Readonly<Record<Exclude<NicheSort, 'demand'>, Measure>> = {
  breakout: (channel) => bestScore(channel),
  // Youngest first: the age is negated so the highest number is the newest.
  newest: (channel, now) => {
    const days = channel.channelAgeDays ?? accountAgeDays(channel, now);
    return days === null ? null : -days;
  },
  views: (channel) => channel.recentViews,
  'per-subscriber': (channel) => channel.viewsPerSubscriber,
  revenue: (channel) => (channel.earnings.high > 0 ? estimateMiddle(channel.earnings) : null),
  rpm: (channel) => rpmOf(channel)?.middle ?? null,
};

/**
 * The channels in the chosen order, on a new array. Ties, and "most 90-day
 * views", keep the stored order, which is already most 90-day views first.
 */
export function sortNiches(
  channels: readonly NicheChannel[],
  sort: NicheSort,
  now: Date,
): readonly NicheChannel[] {
  if (sort === 'demand') return channels;
  const measure = MEASURES[sort];
  return channels
    .map((channel, index) => ({ channel, index, value: measure(channel, now) }))
    .sort((a, b) => {
      if (a.value === b.value) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return b.value - a.value;
    })
    .map((entry) => entry.channel);
}

export const isNicheSort = (value: unknown): value is NicheSort =>
  NICHE_SORTS.some((option) => option.id === value);

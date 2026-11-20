import type { BreakoutVideo, CompetitorStatus } from '@jgtube/core';
// Only this file of the engine is loaded, never its index: the index would
// pull the store and the YouTube client into the browser bundle.
import { SMALL_CHANNEL_MAX_SUBSCRIBERS } from '@jgtube/core/src/limits';
import { formatAge, formatCount } from './format';

export type BreakoutFilter = 'all' | '100x' | '50x' | 'small';

export const BREAKOUT_FILTERS: readonly { readonly id: BreakoutFilter; readonly label: string }[] =
  [
    { id: 'all', label: 'All outliers' },
    { id: '100x', label: '100×+' },
    { id: '50x', label: '50×+' },
    { id: 'small', label: 'Under 10K' },
  ];

export function filterBreakouts<T extends BreakoutVideo>(
  items: readonly T[],
  filter: BreakoutFilter,
): readonly T[] {
  if (filter === '100x') return items.filter((item) => item.score >= 100);
  if (filter === '50x') return items.filter((item) => item.score >= 50);
  if (filter === 'small') {
    return items.filter(
      (item) =>
        item.channelSubscribers !== null && item.channelSubscribers < SMALL_CHANNEL_MAX_SUBSCRIBERS,
    );
  }
  return items;
}

/** 'peers' shows channels like the centre that the owner has not removed; 'all' shows everything. */
export type Scope = 'peers' | 'all';

export function inScope<T extends { readonly peer: boolean; readonly removed?: boolean }>(
  items: readonly T[],
  scope: Scope,
): readonly T[] {
  return scope === 'peers' ? items.filter((item) => item.peer && !item.removed) : items;
}

export interface CompetitorAction {
  /** What pressing the button asks for. */
  readonly status: CompetitorStatus;
  readonly label: string;
}

const REMOVE: CompetitorAction = { status: 'removed', label: 'Not a competitor: remove' };

/**
 * What the owner can do about one channel, most likely choice first. A removed
 * channel can only be restored; a kept one can be let go or removed; a channel
 * the filter left out can be kept.
 */
export function competitorActions(channel: {
  readonly peer: boolean;
  readonly removed?: boolean;
  readonly kept?: boolean;
}): readonly CompetitorAction[] {
  if (channel.removed) return [{ status: 'auto', label: 'Restore to my competitors' }];
  if (channel.kept) return [{ status: 'auto', label: 'Kept by you: undo' }, REMOVE];
  if (!channel.peer) return [{ status: 'kept', label: 'Keep as a competitor' }, REMOVE];
  return [REMOVE];
}

/** In words, what a breakout score rests on, so a big number can be weighed. */
export function describeEvidence(item: BreakoutVideo): string {
  return [
    `Usually ${formatCount(item.baseline)} views`,
    `compared with ${item.sampleSize} video${item.sampleSize === 1 ? '' : 's'}`,
    `${item.channelHits} of ${item.channelScored} recent videos broke out`,
    ...(item.channelAgeDays === null
      ? []
      : [`channel about ${formatAge(item.channelAgeDays)} old`]),
  ].join(' · ');
}

import type { BreakoutVideo } from '@jgtube/core';

export type BreakoutFilter = 'all' | '100x' | '50x' | 'small';

export const BREAKOUT_FILTERS: readonly { readonly id: BreakoutFilter; readonly label: string }[] =
  [
    { id: 'all', label: 'All outliers' },
    { id: '100x', label: '100×+' },
    { id: '50x', label: '50×+' },
    { id: 'small', label: 'Under 10K' },
  ];

const SMALL_CHANNEL_SUBSCRIBERS = 10_000;

export function filterBreakouts(
  items: readonly BreakoutVideo[],
  filter: BreakoutFilter,
): readonly BreakoutVideo[] {
  if (filter === '100x') return items.filter((item) => item.score >= 100);
  if (filter === '50x') return items.filter((item) => item.score >= 50);
  if (filter === 'small') {
    return items.filter(
      (item) =>
        item.channelSubscribers !== null && item.channelSubscribers < SMALL_CHANNEL_SUBSCRIBERS,
    );
  }
  return items;
}

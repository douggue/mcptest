import type { ChannelHistory } from '../changes/changes';
import { CADENCE_WINDOW_DAYS, uploadsPerWeek } from '../map/peers';
import { channelMetrics } from '../map/view';
import { median } from '../scoring/outlier';

/**
 * How often the look-alikes that took off on this map upload: the median of
 * their uploads a week, counted as the map counts them (the last
 * `CADENCE_WINDOW_DAYS` days). A comparison, not a target.
 */

export { CADENCE_WINDOW_DAYS as PACE_WINDOW_DAYS };

export interface WinnersPace {
  /** Look-alikes counted as taken off now. */
  readonly channels: number;
  /** Their median uploads a week; null when none has taken off. */
  readonly medianPerWeek: number | null;
}

export function winnersPace(lookalikes: readonly ChannelHistory[], now: Date): WinnersPace {
  const rates = lookalikes
    .filter(
      ({ channel, videos }) =>
        channelMetrics(videos, channel.subscribers, now).group === 'taken-off',
    )
    .map(({ videos }) => uploadsPerWeek(videos, now));
  return { channels: rates.length, medianPerWeek: median(rates) };
}

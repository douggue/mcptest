import type { RecEdge } from '../repos/types';
import type { SidebarItem } from '../sources/types';

/** With this many sampled videos or more, one appearance is treated as noise. */
const MIN_SAMPLE_FOR_NOISE_FLOOR = 4;
const NOISE_FLOOR_HITS = 2;

export interface EdgeOptions {
  /** How many recommended channels to keep, strongest first. */
  readonly topChannels: number;
}

/**
 * Turns the sidebars of a channel's sampled videos into recommendation edges.
 *
 * A channel "recommends" another when the other's videos appear next to its
 * own; the share is the fraction of sampled videos that happened on.
 */
export function buildEdges(
  fromChannelId: string,
  sidebars: ReadonlyMap<string, readonly SidebarItem[]>,
  options: EdgeOptions,
): readonly RecEdge[] {
  const sampled = sidebars.size;
  if (sampled === 0) return [];

  const videosByChannel = new Map<string, Set<string>>();
  for (const [videoId, items] of sidebars) {
    for (const item of items) {
      if (!item.channelId || item.channelId === fromChannelId) continue;
      const seen = videosByChannel.get(item.channelId) ?? new Set<string>();
      seen.add(videoId);
      videosByChannel.set(item.channelId, seen);
    }
  }

  const minimumHits = sampled >= MIN_SAMPLE_FOR_NOISE_FLOOR ? NOISE_FLOOR_HITS : 1;
  return [...videosByChannel]
    .map(([toChannelId, videos]): RecEdge => ({
      fromChannelId,
      toChannelId,
      hits: videos.size,
      sampled,
      share: videos.size / sampled,
    }))
    .filter((edge) => edge.hits >= minimumHits)
    .sort((a, b) => b.hits - a.hits || a.toChannelId.localeCompare(b.toChannelId))
    .slice(0, options.topChannels);
}

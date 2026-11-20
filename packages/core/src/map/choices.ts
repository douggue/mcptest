import { DEFAULT_BREAKOUT_LIMIT, listBreakouts } from './breakouts';
import type { MapSnapshot, SnapshotBreakout, SnapshotChannel, SnapshotDeps } from './snapshot';
import type { MapMemberData } from './view';

/**
 * The owner's own say over a map: channels they removed from their competitors
 * and channels they kept although the filter left them out. Both are applied
 * each time a map is read, never frozen into it, so a choice made today shows
 * on a map made last week and on every later map of the same centre.
 */

/**
 * The owner's say on whether a channel is a competitor. 'kept': count it even
 * though the filter left it out. 'removed': never count it. 'auto': no say,
 * the filter decides.
 */
export const COMPETITOR_STATUSES = ['kept', 'removed', 'auto'] as const;
export type CompetitorStatus = (typeof COMPETITOR_STATUSES)[number];

/** A map as built or frozen, before the owner's choices; older frozen copies lack some fields. */
type UnmarkedChannel = Omit<SnapshotChannel, 'removed' | 'kept'>;

/** The stored channel and videos behind a snapshot channel, when the store still has them. */
function memberOf(deps: SnapshotDeps, channel: UnmarkedChannel): MapMemberData[] {
  const stored = deps.channels.findById(channel.id);
  return stored
    ? [{ channel: stored, steps: channel.steps, videos: deps.videos.listByChannel(stored.id) }]
    : [];
}

/**
 * The feed without the removed channels' videos and with the pulled-in
 * channels' videos among the peers' videos.
 *
 * A frozen feed keeps only the strongest outsiders, so a kept channel's videos
 * may not be in it at all. They are read from the store as it is now instead,
 * as the thumbnail board's are. Removed channels are taken out before the feed
 * is cut to its length, so the places they held go to the next videos instead
 * of leaving the feed short.
 */
function feedWith(
  deps: SnapshotDeps,
  snapshot: MapSnapshot,
  pulledIn: readonly UnmarkedChannel[],
  removed: ReadonlySet<string>,
  now: Date,
): readonly SnapshotBreakout[] {
  const shown = snapshot.breakouts.filter((video) => !removed.has(video.channelId));
  if (pulledIn.length === 0) return shown;
  const pulledIds = new Set(pulledIn.map((channel) => channel.id));
  const fresh = listBreakouts(
    pulledIn.flatMap((channel) => memberOf(deps, channel)),
    now,
  ).map((video) => ({ ...video, peer: true }));
  const peers = [...shown.filter((video) => video.peer), ...fresh]
    .sort((a, b) => b.score - a.score || b.views - a.views)
    .slice(0, DEFAULT_BREAKOUT_LIMIT);
  const outsiders = shown.filter((video) => !video.peer && !pulledIds.has(video.channelId));
  return [...peers, ...outsiders];
}

/**
 * Marks each channel as removed or kept and counts a kept channel as a peer
 * everywhere a peer counts: the channel list, the breakout feed and, through
 * them, the thumbnail board. `outsideReason` is left as the filter gave it, so
 * the screen can still say why a kept channel was left out.
 */
export function applyOwnerChoices(
  deps: SnapshotDeps,
  snapshot: MapSnapshot,
  centerChannelId: string,
  now: Date,
): MapSnapshot {
  const removed = new Set(deps.maps.listRemoved(centerChannelId));
  const kept = new Set(deps.maps.listKept(centerChannelId).filter((id) => !removed.has(id)));
  const unmarked: readonly UnmarkedChannel[] = snapshot.channels;
  const channels = unmarked.map((channel) => ({
    ...channel,
    peer: channel.peer || kept.has(channel.id),
    removed: removed.has(channel.id),
    kept: kept.has(channel.id),
  }));
  const pulledIn = unmarked.filter((channel) => kept.has(channel.id) && !channel.peer);
  return {
    ...snapshot,
    // Peers lead the list, as they do on a map as built.
    channels: [
      ...channels.filter((channel) => channel.peer),
      ...channels.filter((channel) => !channel.peer),
    ],
    breakouts: feedWith(deps, snapshot, pulledIn, removed, now),
  };
}

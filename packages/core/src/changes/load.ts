import { loadMapSnapshot, type SnapshotDeps } from '../map/snapshot';
import type { RefreshRunRepo, VideoRepo } from '../repos/types';
import { mapChanges, type ChannelHistory, type MapChanges } from './changes';
import { lookalikeChanges, type LookalikeChanges } from './lookalikes';
import type { LookRepo } from './store';

/**
 * "What changed since you last looked", read from the store for one centre
 * channel: its map's look-alikes and nothing past them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Since yesterday" and "since 7 days", counted back from now. */
export const CHANGES_YESTERDAY_DAYS = 1;
export const CHANGES_WEEK_DAYS = 7;

export const SINCE_KINDS = ['last-look', 'yesterday', 'week'] as const;
export type SinceKind = (typeof SINCE_KINDS)[number];

export interface ChangesDeps extends SnapshotDeps {
  readonly videos: VideoRepo;
  readonly runs: Pick<RefreshRunRepo, 'latest'>;
  readonly looks: LookRepo;
}

/** How fresh the readings behind the comparison are. Times are ISO-8601 strings. */
export interface ChangesFreshness {
  /** The look-alikes the comparison covers. */
  readonly channels: number;
  /** When the look-alike read longest ago was read, and the one read most recently. */
  readonly oldestReadAt: string | null;
  readonly newestReadAt: string | null;
  /** When the last refresh of the store finished; null when there has been none. */
  readonly lastRefreshAt: string | null;
}

export interface ChangesView {
  readonly centerChannelId: string;
  readonly since: string;
  readonly now: string;
  readonly changes: MapChanges;
  readonly lookalikes: LookalikeChanges;
  readonly freshness: ChangesFreshness;
}

/**
 * The moment a comparison starts from. With no last look stored, "since your
 * last look" is answered for a week, and the kind returned says so.
 */
export function resolveSince(
  kind: SinceKind,
  lastLook: Date | null,
  now: Date,
): { readonly since: Date; readonly kind: SinceKind } {
  const back = (days: number): Date => new Date(now.getTime() - days * DAY_MS);
  if (kind === 'yesterday') return { since: back(CHANGES_YESTERDAY_DAYS), kind };
  if (kind === 'last-look' && lastLook !== null) return { since: lastLook, kind };
  return { since: back(CHANGES_WEEK_DAYS), kind: 'week' };
}

const isoOrNull = (time: number, count: number): string | null =>
  count > 0 ? new Date(time).toISOString() : null;

export type HistoryDeps = SnapshotDeps & { readonly videos: VideoRepo };

/** The look-alikes of a centre channel's latest map with every stored reading of their videos. */
export interface MapHistories {
  readonly mapId: number;
  readonly peers: readonly { readonly id: string; readonly title: string }[];
  readonly histories: readonly ChannelHistory[];
}

/** A centre channel's look-alikes and their stored readings; null when it has no map. */
export function lookalikeHistories(
  deps: HistoryDeps,
  centerChannelId: string,
  now: Date,
): MapHistories | null {
  const map = deps.maps.latestForCenter(centerChannelId);
  const snapshot = map ? loadMapSnapshot(deps, centerChannelId, now) : null;
  if (!map || !snapshot) return null;
  const peers = snapshot.channels.filter((channel) => channel.peer && !channel.removed);
  const histories = peers.flatMap((peer): ChannelHistory[] => {
    const channel = deps.channels.findById(peer.id);
    if (!channel) return [];
    return [
      {
        channel,
        videos: deps.videos.listByChannel(peer.id),
        readings: deps.videos.listChannelReadings(peer.id, new Date(0)),
      },
    ];
  });
  return { mapId: map.id, peers, histories };
}

/** What changed around a centre channel since a moment; null when it has no map. */
export function loadChanges(
  deps: ChangesDeps,
  centerChannelId: string,
  since: Date,
  now: Date,
): ChangesView | null {
  const found = lookalikeHistories(deps, centerChannelId, now);
  if (!found) return null;
  const { mapId, peers, histories } = found;
  const readAt = histories.map((history) => history.channel.fetchedAt.getTime());
  return {
    centerChannelId,
    since: since.toISOString(),
    now: now.toISOString(),
    changes: mapChanges({ lookalikes: histories, since, now }),
    lookalikes: lookalikeChanges(
      mapId,
      peers.map((peer) => ({ channelId: peer.id, title: peer.title })),
      deps.looks.mapAsOf(centerChannelId, since),
      {
        kept: new Set(deps.maps.listKept(centerChannelId)),
        removed: new Set(deps.maps.listRemoved(centerChannelId)),
      },
    ),
    freshness: {
      channels: histories.length,
      oldestReadAt: isoOrNull(Math.min(...readAt), readAt.length),
      newestReadAt: isoOrNull(Math.max(...readAt), readAt.length),
      lastRefreshAt: deps.runs.latest()?.finishedAt.toISOString() ?? null,
    },
  };
}

import type { MapRepo } from '../repos/types';
import { listBreakouts, type BreakoutVideo } from './breakouts';
import type { OutsideReason } from './peers';
import { loadMapView, type Breakout, type MapViewDeps, type Recommender, type Tier } from './view';

/**
 * A stored map as plain values (strings, numbers, arrays), ready to serialise
 * for the web app or a connector. Nothing in it is a Date or a class instance.
 */
export interface MapSnapshot {
  readonly mapId: number;
  readonly depth: number;
  readonly region: string;
  /** When the map was crawled, as an ISO-8601 string. */
  readonly createdAt: string;
  readonly center: SnapshotCenter;
  readonly channels: readonly SnapshotChannel[];
  readonly edges: readonly SnapshotEdge[];
  readonly breakouts: readonly SnapshotBreakout[];
}

export interface SnapshotBreakout extends BreakoutVideo {
  /** Whether the video's channel is a peer of the centre. */
  readonly peer: boolean;
}

export interface SnapshotCenter {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  readonly subscribers: number | null;
  readonly storedVideos: number;
}

export interface SnapshotChannel {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  readonly subscribers: number | null;
  readonly steps: number;
  readonly tier: Tier;
  /** Title similarity to the centre, 0 to 1. */
  readonly relevance: number;
  /** Share of the centre's sampled videos this channel appeared next to; null when not a direct neighbour. */
  readonly centerShare: number | null;
  readonly recentViews: number;
  readonly recentUploads: number;
  readonly rising: boolean;
  readonly breakout: Breakout | null;
  readonly recommendedBy: readonly Recommender[];
  /** The same kind of channel as the centre. */
  readonly peer: boolean;
  readonly outsideReason: OutsideReason | null;
}

export interface SnapshotEdge {
  readonly from: string;
  readonly to: string;
  readonly share: number;
}

export interface SnapshotDeps extends MapViewDeps {
  readonly maps: MapRepo;
}

/** The latest saved map around a channel, or null when none has been crawled. */
export function loadMapSnapshot(
  deps: SnapshotDeps,
  centerChannelId: string,
  now: Date,
): MapSnapshot | null {
  const map = deps.maps.latestForCenter(centerChannelId);
  if (!map) return null;
  const view = loadMapView(deps, map.members, map.depth, now);
  if (!view) return null;
  const { center, rows, members, edges } = view;
  const peerIds = new Set(rows.filter((row) => row.peer).map((row) => row.channel.id));

  return {
    mapId: map.id,
    depth: map.depth,
    region: map.region,
    createdAt: map.createdAt.toISOString(),
    center: {
      id: center.channel.id,
      title: center.channel.title,
      handle: center.channel.handle,
      subscribers: center.channel.subscribers,
      storedVideos: center.videos.length,
    },
    channels: rows.map((row) => ({
      id: row.channel.id,
      title: row.channel.title,
      handle: row.channel.handle,
      subscribers: row.channel.subscribers,
      steps: row.steps,
      tier: row.tier,
      relevance: row.relevance,
      centerShare:
        row.recommendedBy.find((source) => source.channelId === center.channel.id)?.share ?? null,
      recentViews: row.metrics.recentViews,
      recentUploads: row.metrics.recentUploads,
      rising: row.metrics.rising,
      breakout: row.metrics.breakout,
      recommendedBy: row.recommendedBy,
      peer: row.peer,
      outsideReason: row.outsideReason,
    })),
    edges: edges.map((edge) => ({
      from: edge.fromChannelId,
      to: edge.toChannelId,
      share: edge.share,
    })),
    // Listed separately so that loud outsiders cannot crowd peers out of the feed.
    breakouts: [
      ...listBreakouts(
        members.filter((member) => peerIds.has(member.channel.id)),
        now,
      ).map((video) => ({ ...video, peer: true })),
      ...listBreakouts(
        members.filter((member) => !peerIds.has(member.channel.id)),
        now,
      ).map((video) => ({ ...video, peer: false })),
    ],
  };
}

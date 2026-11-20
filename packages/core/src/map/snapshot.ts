import { z } from 'zod';
import type { MapRepo, StoredMap } from '../repos/types';
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
  /** The channel the map is measured against instead of the centre, when the owner named one. */
  readonly model: SnapshotModel | null;
  readonly channels: readonly SnapshotChannel[];
  readonly edges: readonly SnapshotEdge[];
  readonly breakouts: readonly SnapshotBreakout[];
}

export interface SnapshotModel {
  readonly id: string;
  readonly title: string;
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
  /** The owner removed this channel from their competitors. */
  readonly removed: boolean;
}

export interface SnapshotEdge {
  readonly from: string;
  readonly to: string;
  readonly share: number;
}

export interface SnapshotDeps extends MapViewDeps {
  readonly maps: MapRepo;
}

/** Builds a map's snapshot from what the store holds right now. */
function buildSnapshot(deps: SnapshotDeps, map: StoredMap, now: Date): MapSnapshot | null {
  const view = loadMapView(deps, map.members, map.depth, now, map.modelChannelId);
  if (!view) return null;
  const { center, rows, members, edges } = view;
  const model = members.find((member) => member.channel.id === map.modelChannelId) ?? null;
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
    model: model ? { id: model.channel.id, title: model.channel.title } : null,
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
      removed: false,
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

/** Raised when the stored shape changes, so older copies are rebuilt instead of misread. */
// 3: title matching changed, so the peers in older frozen copies are out of date.
export const SNAPSHOT_FORMAT = 3;

/** Checks the parts every reader relies on; the rest is carried through as stored. */
const storedSnapshot = z.object({
  format: z.literal(SNAPSHOT_FORMAT),
  snapshot: z.looseObject({
    mapId: z.number(),
    center: z.looseObject({ id: z.string() }),
    channels: z.array(z.looseObject({ id: z.string(), peer: z.boolean() })),
    breakouts: z.array(z.looseObject({ channelId: z.string(), peer: z.boolean() })),
    edges: z.array(z.looseObject({ from: z.string(), to: z.string() })),
  }),
});

function parseStored(json: string | null, mapId: number): MapSnapshot | null {
  if (json === null) return null;
  try {
    const parsed = storedSnapshot.safeParse(JSON.parse(json));
    if (!parsed.success || parsed.data.snapshot.mapId !== mapId) return null;
    return parsed.data.snapshot as unknown as MapSnapshot;
  } catch {
    return null;
  }
}

/**
 * Records the latest map around a channel as it looks now, so that opening it
 * later shows what was found then, whatever has been crawled since.
 */
export function freezeMapSnapshot(
  deps: SnapshotDeps,
  centerChannelId: string,
  now: Date,
): MapSnapshot | null {
  const map = deps.maps.latestForCenter(centerChannelId);
  const snapshot = map ? buildSnapshot(deps, map, now) : null;
  if (map && snapshot) {
    deps.maps.saveSnapshot(map.id, JSON.stringify({ format: SNAPSHOT_FORMAT, snapshot }));
  }
  return snapshot;
}

/**
 * The latest saved map around a channel, or null when none has been crawled.
 *
 * The frozen copy is used when there is one (maps made before snapshots were
 * stored are rebuilt from current data). The owner's removals are applied on
 * every read, so a removed channel stays removed across new crawls.
 */
export function loadMapSnapshot(
  deps: SnapshotDeps,
  centerChannelId: string,
  now: Date,
): MapSnapshot | null {
  const map = deps.maps.latestForCenter(centerChannelId);
  if (!map) return null;
  const snapshot =
    parseStored(deps.maps.findSnapshot(map.id), map.id) ?? buildSnapshot(deps, map, now);
  if (!snapshot) return null;
  const removed = new Set(deps.maps.listRemoved(centerChannelId));
  return {
    ...snapshot,
    // Copies frozen before model channels existed do not carry the field.
    model: snapshot.model ?? null,
    channels: snapshot.channels.map((channel) => ({
      ...channel,
      removed: removed.has(channel.id),
    })),
    breakouts: snapshot.breakouts.filter((video) => !removed.has(video.channelId)),
  };
}

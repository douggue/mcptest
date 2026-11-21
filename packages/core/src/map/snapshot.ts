import { z } from 'zod';
import { LOGO_SHOWN_MIN_WIDTH, pickImage } from '../channel/brand';
import type { BrandRepo, MapRepo, StoredMap } from '../repos/types';
import { listBreakouts, type BreakoutVideo } from './breakouts';
import { applyOwnerChoices } from './choices';
import type { ChannelGroup } from './mix';
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
  /**
   * The address of the channel's logo, or null when none has been read.
   * Added on every read from the store as it is now; a frozen copy never holds it.
   */
  readonly logoUrl?: string | null;
}

export interface SnapshotChannel {
  readonly id: string;
  readonly title: string;
  /** The address of the channel's logo, or null when none has been read. Added on every read. */
  readonly logoUrl?: string | null;
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
  /**
   * Whether the channel has already taken off, is rising, or is neither (see
   * `map/mix.ts`). The look-alikes are listed in a mix of the first two.
   */
  readonly group: ChannelGroup;
  /** Views on its uploads of the last 90 days, which the group rests on. */
  readonly ninetyDayViews: number;
  /** How many of those uploads were widely seen, which the group rests on too. */
  readonly widelySeenUploads: number;
  readonly breakout: Breakout | null;
  readonly recommendedBy: readonly Recommender[];
  /** The same kind of channel as the centre, or one the owner kept as a competitor. */
  readonly peer: boolean;
  /** Why the filter did not count it as a peer; null when it did. Stays set on a kept channel. */
  readonly outsideReason: OutsideReason | null;
  /**
   * False when the filter's call changed on a random half of the map: it hangs
   * on which other channels are on the map, not only on this one and the reference.
   */
  readonly settled: boolean;
  /** The owner removed this channel from their competitors. */
  readonly removed: boolean;
  /** The owner counts this channel as a competitor, whatever the filter says. */
  readonly kept: boolean;
}

export interface SnapshotEdge {
  readonly from: string;
  readonly to: string;
  readonly share: number;
}

export interface SnapshotDeps extends MapViewDeps {
  readonly maps: MapRepo;
  /** Where channel logos are kept. Without it a snapshot carries no logos. */
  readonly brands?: Pick<BrandRepo, 'find'>;
}

/** A channel the owner has made a map for: enough to offer it again without reading anything. */
export interface SavedChannel {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  readonly subscribers: number | null;
  readonly logoUrl: string | null;
  /** When its latest map was made, as an ISO-8601 string. */
  readonly mapMadeAt: string;
  /** How many other channels that map holds. */
  readonly channelCount: number;
}

/**
 * Every channel a map has been made for, the most recently mapped first.
 * Maps are kept when another channel is looked up, so each of these can be
 * opened again from the store without a new crawl.
 */
export function listSavedChannels(deps: SnapshotDeps): readonly SavedChannel[] {
  const saved = deps.maps.listCenterIds().flatMap((centerId): SavedChannel[] => {
    const map = deps.maps.latestForCenter(centerId);
    const channel = deps.channels.findById(centerId);
    if (!map || !channel) return [];
    const logo = pickImage(deps.brands?.find(centerId)?.avatar ?? [], LOGO_SHOWN_MIN_WIDTH);
    return [
      {
        id: channel.id,
        title: channel.title,
        handle: channel.handle,
        subscribers: channel.subscribers,
        logoUrl: logo?.url ?? null,
        mapMadeAt: map.createdAt.toISOString(),
        channelCount: map.members.filter((member) => member.channelId !== centerId).length,
      },
    ];
  });
  return [...saved].sort((a, b) => b.mapMadeAt.localeCompare(a.mapMadeAt));
}

/**
 * The snapshot with each channel's logo as the store has it now. Logos are
 * read when a channel is, so a map frozen earlier gains them as its channels
 * are read again.
 */
function withLogos(deps: SnapshotDeps, snapshot: MapSnapshot): MapSnapshot {
  const { brands } = deps;
  if (!brands) return snapshot;
  const logoOf = (channelId: string): string | null =>
    pickImage(brands.find(channelId)?.avatar ?? [], LOGO_SHOWN_MIN_WIDTH)?.url ?? null;
  return {
    ...snapshot,
    center: { ...snapshot.center, logoUrl: logoOf(snapshot.center.id) },
    channels: snapshot.channels.map((channel) => ({ ...channel, logoUrl: logoOf(channel.id) })),
  };
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
      group: row.metrics.group,
      ninetyDayViews: row.metrics.ninetyDayViews,
      widelySeenUploads: row.metrics.widelySeenUploads,
      breakout: row.metrics.breakout,
      recommendedBy: row.recommendedBy,
      peer: row.peer,
      outsideReason: row.outsideReason,
      settled: row.settled,
      removed: false,
      kept: false,
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
// 4: a channel that stopped uploading is no longer a peer, and a feed holds only a
//    few videos per channel; older copies name the wrong peers and a flooded feed.
// 5: each channel says whether its look-alike call is settled; older copies do not,
//    and would show every call as a confident yes or no. The calls themselves are the same.
// 6: each channel says whether it has taken off, is rising or is neither, and the
//    look-alikes are listed in a mix of the first two; older copies carry no group and
//    list them by title match alone. Who is a look-alike is the same.
export const SNAPSHOT_FORMAT = 6;

const CHANNEL_GROUPS = [
  'taken-off',
  'rising',
  'neither',
] as const satisfies readonly ChannelGroup[];

/** Checks the parts every reader relies on; the rest is carried through as stored. */
const storedSnapshot = z.object({
  format: z.literal(SNAPSHOT_FORMAT),
  snapshot: z.looseObject({
    mapId: z.number(),
    center: z.looseObject({ id: z.string() }),
    channels: z.array(
      z.looseObject({
        id: z.string(),
        peer: z.boolean(),
        settled: z.boolean(),
        group: z.enum(CHANNEL_GROUPS),
      }),
    ),
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
 * stored are rebuilt from current data). The owner's choices (channels removed,
 * channels kept) are applied on every read, so they hold across new crawls.
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
  // Copies frozen before model channels existed do not carry the field.
  const chosen = applyOwnerChoices(
    deps,
    { ...snapshot, model: snapshot.model ?? null },
    centerChannelId,
    now,
  );
  return withLogos(deps, chosen);
}

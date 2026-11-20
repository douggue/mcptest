import type { ChannelInfo, StorableVideo } from '../sources/types';

export interface StoredChannel extends ChannelInfo {
  readonly fetchedAt: Date;
}

export interface StoredVideo extends StorableVideo {
  readonly fetchedAt: Date;
}

export interface ViewSnapshot {
  readonly capturedAt: Date;
  readonly views: number;
}

/** Runs a group of writes so that either all of them are stored or none is. */
export type Transact = (work: () => void) => void;

export interface ChannelRepo {
  findById(id: string): StoredChannel | null;
  findByHandle(handle: string): StoredChannel | null;
  upsert(channel: ChannelInfo, fetchedAt: Date): void;
}

export interface VideoRepo {
  listByChannel(channelId: string): readonly StoredVideo[];
  /** Stores the videos and records one view-count snapshot for each. */
  upsertMany(videos: readonly StorableVideo[], fetchedAt: Date): void;
  listSnapshots(videoId: string): readonly ViewSnapshot[];
}

/** One channel's videos were shown next to another's: `hits` of the `sampled` videos read. */
export interface RecEdge {
  readonly fromChannelId: string;
  readonly toChannelId: string;
  readonly hits: number;
  readonly sampled: number;
  readonly share: number;
}

export interface EdgeReading {
  readonly crawledAt: Date;
  /** Country the recommendations were read from. */
  readonly region: string;
  readonly edges: readonly RecEdge[];
}

export interface EdgeRepo {
  /** Null means this channel's recommendations were never read; an empty list means none were found. */
  listFrom(fromChannelId: string): EdgeReading | null;
  replaceFrom(
    fromChannelId: string,
    edges: readonly RecEdge[],
    region: string,
    crawledAt: Date,
  ): void;
  /** Every stored edge whose two ends are both in the given set. */
  listAmong(channelIds: readonly string[]): readonly RecEdge[];
}

export interface MapMember {
  readonly channelId: string;
  /** Recommendation hops from the centre; the centre itself is 0. */
  readonly steps: number;
}

export interface NewMap {
  readonly centerChannelId: string;
  readonly depth: number;
  readonly region: string;
  readonly members: readonly MapMember[];
}

export interface StoredMap extends NewMap {
  readonly id: number;
  readonly createdAt: Date;
}

export interface MapRepo {
  create(map: NewMap, createdAt: Date): number;
  latestForCenter(centerChannelId: string): StoredMap | null;
  /** Stores the map as it looked when it was made, as JSON. */
  saveSnapshot(mapId: number, snapshotJson: string): void;
  findSnapshot(mapId: number): string | null;
  /** Channels the owner removed from this centre's competitors; survives new crawls. */
  listRemoved(centerChannelId: string): readonly string[];
  setRemoved(centerChannelId: string, channelId: string, removed: boolean, at: Date): void;
}

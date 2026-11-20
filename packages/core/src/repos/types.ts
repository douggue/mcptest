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

/** One video's view count at one reading of its channel. */
export interface VideoReading {
  readonly videoId: string;
  readonly capturedAt: Date;
  readonly views: number;
}

/** Runs a group of writes so that either all of them are stored or none is. */
export type Transact = (work: () => void) => void;

/** A stored channel whose latest reads all failed. */
export interface ReadFailure {
  readonly channelId: string;
  /** Failed reads in a row since the channel was last read. */
  readonly failures: number;
  readonly lastFailedAt: Date;
}

export interface ChannelRepo {
  findById(id: string): StoredChannel | null;
  findByHandle(handle: string): StoredChannel | null;
  /** Every stored channel, whichever crawl read it. */
  listAll(): readonly StoredChannel[];
  /** How many channels the store holds. */
  count(): number;
  /**
   * The channels with at most `maxSubscribers` (or a hidden count) that have a
   * video published at or after `publishedSince`, in the order of `listAll`.
   */
  listActiveUpTo(maxSubscribers: number, publishedSince: Date): readonly StoredChannel[];
  /** Storing a channel also forgets its failed reads: it has just been read. */
  upsert(channel: ChannelInfo, fetchedAt: Date): void;
  /** Notes that a stored channel could not be read; does nothing for one not in the store. */
  recordReadFailure(id: string, failedAt: Date): void;
  /** The stored channels that could not be read the last time it was tried. */
  listReadFailures(): readonly ReadFailure[];
}

export interface VideoRepo {
  listByChannel(channelId: string): readonly StoredVideo[];
  /** Stores the videos and records one view-count snapshot for each. */
  upsertMany(videos: readonly StorableVideo[], fetchedAt: Date): void;
  listSnapshots(videoId: string): readonly ViewSnapshot[];
  /** Every view reading of a channel's videos taken at or after `since`, oldest first. */
  listChannelReadings(channelId: string, since: Date): readonly VideoReading[];
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
  /** The channel the owner wants to be like; "like yours" is measured against it. */
  readonly modelChannelId?: string | null;
  readonly depth: number;
  readonly region: string;
  readonly members: readonly MapMember[];
}

export interface StoredMap extends NewMap {
  readonly id: number;
  readonly modelChannelId: string | null;
  readonly createdAt: Date;
}

export interface MapRepo {
  create(map: NewMap, createdAt: Date): number;
  latestForCenter(centerChannelId: string): StoredMap | null;
  /** Each channel a map has been made around. */
  listCenterIds(): readonly string[];
  /** Stores the map as it looked when it was made, as JSON. */
  saveSnapshot(mapId: number, snapshotJson: string): void;
  findSnapshot(mapId: number): string | null;
  /** Channels the owner removed from this centre's competitors; survives new crawls. */
  listRemoved(centerChannelId: string): readonly string[];
  /** Removing a channel also stops keeping it: the two choices exclude each other. */
  setRemoved(centerChannelId: string, channelId: string, removed: boolean, at: Date): void;
  /** Channels the owner counts as competitors whatever the filter says; survives new crawls. */
  listKept(centerChannelId: string): readonly string[];
  /** Keeping a channel also restores it if it was removed. */
  setKept(centerChannelId: string, channelId: string, kept: boolean, at: Date): void;
}

/** The channels the owner marked as niches to watch; not tied to any one map. */
export interface WatchlistRepo {
  listWatched(): readonly string[];
  /** The channel must be in the store. */
  setWatched(channelId: string, watched: boolean, at: Date): void;
}

/** One finished refresh: how many stored channels were read again, and how it went. */
export interface RefreshRun {
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly refreshed: number;
  readonly failed: number;
  /** YouTube refused several channels in a row, so the run gave up. */
  readonly stoppedEarly: boolean;
}

/** A log of refreshes, so the screen can say when the store was last brought up to date. */
export interface RefreshRunRepo {
  record(run: RefreshRun): void;
  /** The run that finished last, or null when there has been none. */
  latest(): RefreshRun | null;
}

/** What the official API says about a channel, as far as the store keeps it. */
export interface NewFacts {
  readonly id: string;
  /** When the channel account was created, which can be long before its first upload. */
  readonly createdAt: Date;
  /** Two-letter country the owner of the channel set, or null when they set none. */
  readonly country: string | null;
  readonly totalViews: number | null;
}

export interface StoredFacts {
  readonly channelId: string;
  readonly createdAt: Date;
  readonly country: string | null;
  readonly totalViews: number | null;
  /** When the facts were read from the official API. */
  readonly fetchedAt: Date;
}

/** Channel facts from the official API, kept on the channel's own row. */
export interface FactsRepo {
  /** Null when the channel has no stored facts. */
  find(channelId: string): StoredFacts | null;
  /** Of these channels, the stored ones the official API has never been asked about. */
  listMissing(channelIds: readonly string[]): readonly string[];
  /**
   * Stores what the API returned and notes every channel asked about, so one
   * the API does not know is not asked about again on every run.
   */
  record(askedIds: readonly string[], facts: readonly NewFacts[], fetchedAt: Date): void;
}

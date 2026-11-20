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

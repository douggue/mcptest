/** The outlier bank as the API and the connector see it. */
import type {
  BankCollection,
  BankFilterState,
  BankVideo,
  BrandRepo,
  ChannelSnapshot,
  ChannelRepo,
  Db,
  FindProgress,
  FindVia,
  MapSnapshot,
  SearchHit,
  VideoRepo,
} from '@jgtube/core';
import type { LazySource } from './connection';

export type { BankLook, FindInfo, FindResult } from '@jgtube/core/src/bank/view';
import type { BankLook, FindInfo, FindResult } from '@jgtube/core/src/bank/view';

/** One stored video as its own page shows it. */
export interface BankVideoLook {
  readonly video: BankVideo;
  /** The owner's collections, and which of them hold this video. */
  readonly collections: readonly BankCollection[];
  readonly saved: readonly number[];
}

export interface CollectionFile {
  readonly filename: string;
  readonly type: string;
  readonly text: string;
}

/** The bank's engine with what other parts of the server build on. */
export interface BankInside extends BankEngine {
  /** Every video in the bank as last built. */
  videos(): readonly BankVideo[];
}

export interface BankEngine {
  /** One page of the bank under the filters given; reads the store only. */
  look(state: BankFilterState, page: { readonly offset: number; readonly limit: number }): BankLook;
  /** One stored video with its score and the collections it is in; null when it is not stored. */
  video(videoId: string): BankVideoLook | null;
  /** How a find would read YouTube now, what it would cost, and what is left of today's cap. */
  findInfo(channels: number): FindInfo;
  /** Searches and reads the channels found, under the store's lease. */
  findMore(
    request: { readonly query: string; readonly maxChannels: number },
    onProgress: (progress: FindProgress) => void,
  ): Promise<FindResult>;
  readonly collections: {
    list(): readonly BankCollection[];
    create(name: string): BankCollection | null;
    remove(id: number): boolean;
    /** False when the collection is not there. */
    add(id: number, videoId: string): boolean;
    take(id: number, videoId: string): boolean;
    /** Null when the collection is not there. */
    exportAs(id: number, as: 'csv' | 'md'): CollectionFile | null;
  };
}

/** What the bank is built from. Tests replace the network parts. */
export interface BankFindDeps {
  readonly db: Db;
  readonly now: () => Date;
  readonly repos: {
    readonly channels: ChannelRepo;
    readonly videos: VideoRepo;
    readonly brands?: BrandRepo;
  };
  readonly transact: (work: () => void) => void;
  /** The owner's latest map of each saved channel. */
  readonly snapshots: () => readonly MapSnapshot[];
  /** The key as it is set now; undefined without one. */
  readonly apiKey: () => string | undefined;
  /** YouTube's pages, paced, connected on first use. */
  readonly source: LazySource;
  /** Runs work that reads YouTube under the store's lease. */
  readonly reading: <T>(work: () => Promise<T>) => Promise<T>;
  /**
   * The owner's reading budget per day and what else spent from it (the niche
   * sweeps), so finds and sweeps share one number. Without it the usual cap holds.
   */
  readonly budget?: {
    readonly pageCap: () => number;
    readonly alsoSpent: (via: FindVia, since: Date) => number;
  };
  readonly apiSearch?: (
    query: string,
    options: { readonly apiKey: string; readonly publishedAfter: Date },
  ) => Promise<readonly SearchHit[]>;
  readonly fetchApiChannel?: (
    channelId: string,
    maxVideos: number,
    options: { readonly apiKey: string; readonly onRequest?: () => void },
  ) => Promise<ChannelSnapshot>;
}

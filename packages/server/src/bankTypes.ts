/** The outlier bank as the API and the connector see it. */
import type {
  BankCollection,
  BankFilterState,
  BankPage,
  BrandRepo,
  ChannelSnapshot,
  ChannelRepo,
  Db,
  FindAllowance,
  FindOutcome,
  FindPlan,
  FindProgress,
  FindVia,
  MapSnapshot,
  SearchHit,

  VideoRepo,
} from '@jgtube/core';
import type { LazySource } from './connection';

export interface BankLook {
  /** When the bank was last worked out from the store, ISO-8601. */
  readonly builtAt: string;
  readonly page: BankPage;
  readonly collections: readonly BankCollection[];
}

export interface FindInfo {
  readonly via: FindVia;
  /** The most a run of that many channels can cost, said before it starts. */
  readonly plan: FindPlan;
  readonly allowance: FindAllowance;
  /** The topics that can be searched for, by label. */
  readonly topics: readonly string[];
}

export interface FindResult extends FindOutcome {
  /** Videos in the bank before and after the run. */
  readonly bankBefore: number;
  readonly bankAfter: number;
}

export interface CollectionFile {
  readonly filename: string;
  readonly type: string;
  readonly text: string;
}

export interface BankEngine {
  /** One page of the bank under the filters given; reads the store only. */
  look(
    state: BankFilterState,
    page: { readonly offset: number; readonly limit: number },
  ): BankLook;
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

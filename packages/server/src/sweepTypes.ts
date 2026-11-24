/** The niche watchlist and its sweeps as the API sees them. */
import type {
  BankVideo,
  BrandRepo,
  ChannelRepo,
  Db,
  FindRepo,
  NicheFound,
  NicheList,
  SweepInfo,
  SweepProgress,
  SweepResult,
  SweepSettings,
  SweepStarter,
  VideoRepo,
} from '@jgtube/core';
import type { BankFindDeps } from './bankTypes';

/** Why a sweep cannot start now: nothing to sweep (409) or nothing left to spend (429). */
export interface SweepRefusal {
  readonly status: 409 | 429;
  readonly message: string;
}

export interface SweepEngine {
  /** The watchlist, the settings, today's budget and the last sweep; the store only. */
  info(): SweepInfo;
  /** 'full' at the most keywords kept, 'kept' when it is on the list already. */
  addKeyword(keyword: string): 'added' | 'kept' | 'full';
  removeKeyword(id: number): boolean;
  setPaused(id: number, paused: boolean): boolean;
  saveSettings(settings: SweepSettings): void;
  /** Whether the schedule's turn has come. */
  isDue(): boolean;
  /** Why a sweep cannot start now, or null when it can. */
  startProblem(): SweepRefusal | null;
  /** Sweeps the watchlist under the store's lease, within what is left of today's budget. */
  sweep(
    startedBy: SweepStarter,
    onProgress: (progress: SweepProgress) => void,
  ): Promise<SweepResult>;
}

/** What the sweep is built from. Tests replace the network parts. */
export interface SweepEngineDeps extends Pick<
  BankFindDeps,
  'now' | 'transact' | 'apiKey' | 'source' | 'reading' | 'apiSearch' | 'fetchApiChannel'
> {
  readonly db: Db;
  readonly repos: {
    readonly channels: ChannelRepo;
    readonly videos: VideoRepo;
    readonly brands?: BrandRepo;
  };
  /** The niche list as it stands now. */
  readonly nicheList: () => NicheList;
  /** Every video in the outlier bank, for the keywords suggested from the owner's maps. */
  readonly bankVideos: () => readonly BankVideo[];
  /** What "Find more outliers" spent, which the same budget covers. */
  readonly finds: FindRepo;
}

/** What the niche list is told about how its channels were found. */
export type FoundSource = () => {
  readonly foundOf: (channelId: string) => NicheFound;
  readonly lastSweepAt: Date | null;
};

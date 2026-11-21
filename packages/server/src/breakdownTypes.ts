import type { FrameSource } from '@jgtube/core';
import type { SkippedEngine } from './engines/failure';
import type { EngineId } from './engines/types';

/** What a breakdown is doing now. */
export type BreakdownStep =
  'reading' | 'file' | 'downloading' | 'cutting' | 'watching' | 'frames' | 'writing';

/** A video whose file could not be had, which the owner can supply themselves. */
export interface VideoToSupply {
  readonly videoId: string;
  readonly title: string;
  /** Why Jgtube has no file of it, in plain words. */
  readonly reason: string;
}

/** One step of a breakdown, for the page to show while it runs. */
export interface BreakdownProgress {
  readonly step: BreakdownStep;
  /** The step in plain words, naming the video and the engine where there is one. */
  readonly text: string;
  /** The videos found so far that the owner can supply a file for. */
  readonly supply: readonly VideoToSupply[];
}

/** Whether one study of a video was made, by whom, or why not. */
export type StudyResult =
  | {
      readonly done: true;
      /** The engine that made it, by its id. */
      readonly by: string;
      /** True when it was kept from an earlier breakdown and not made again. */
      readonly kept: boolean;
    }
  | { readonly done: false; readonly reason: string };

export type FrameStudyResult =
  | {
      readonly done: true;
      readonly by: string;
      readonly kept: boolean;
      /** Where the frames came from; null when an older study did not say. */
      readonly source: FrameSource | null;
      /** How many frames there were to look at; null when an older study did not say. */
      readonly available: number | null;
    }
  | { readonly done: false; readonly reason: string };

/** Which file of a video was used, or why there was none. */
export type VideoFileUsed =
  { readonly used: 'own' | 'downloaded' } | { readonly used: 'none'; readonly reason: string };

/** One of the videos studied in depth, and how each part went. */
export interface StudiedVideo {
  readonly videoId: string;
  readonly title: string;
  readonly file: VideoFileUsed;
  readonly watch: StudyResult;
  readonly frames: FrameStudyResult;
}

/** One of the top videos, and whether its captions could be read. */
export interface TopVideo {
  readonly videoId: string;
  readonly title: string;
  /** 'none': YouTube lists no captions for it. 'failed': they could not be read this time. */
  readonly captions: 'read' | 'none' | 'failed';
}

/** What a finished breakdown leaves behind. */
export interface BreakdownOutcome {
  readonly channel: { readonly id: string; readonly title: string };
  /** How many of the channel's videos are stored: what "top" was taken from. */
  readonly storedVideos: number;
  readonly top: readonly TopVideo[];
  readonly deep: readonly StudiedVideo[];
  /** The videos the owner can supply a file for, to get a deeper study next time. */
  readonly supply: readonly VideoToSupply[];
  /** The folder the owner's own files go in; null when there is nowhere to save. */
  readonly ownVideosFolder: string | null;
  /** The breakdown itself, as plain text. */
  readonly text: string;
  /** The engine that wrote it, and the ones passed over on the way. */
  readonly engine: EngineId;
  readonly skipped: readonly SkippedEngine[];
}

/** What the owner chose for one breakdown. */
export interface BreakdownChoices {
  /** The one engine for the frame studies and the writing; absent, the usual order with its backups. */
  readonly only?: EngineId | undefined;
  /** Make the watch notes and frame studies again instead of reusing stored ones. */
  readonly fresh?: boolean | undefined;
}

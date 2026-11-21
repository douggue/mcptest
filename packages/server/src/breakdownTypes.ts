import type {
  BreakdownFileId,
  BreakdownPartId,
  BreakdownWrittenPart,
  FrameSource,
} from '@jgtube/core';
import type { SkippedEngine } from './engines/failure';
import type { EngineId } from './engines/types';

/** What a breakdown is doing now. */
export type BreakdownStep =
  'reading' | 'file' | 'downloading' | 'cutting' | 'watching' | 'frames' | 'writing' | 'saving';

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
  /** The words its captions hold, counted in code; null without captions. */
  readonly words: number | null;
  /** Those words over the time they are spoken in; null when it cannot be told. */
  readonly wordsPerMinute: number | null;
}

/** How writing one part went in this run. */
export type PartRun = {
  readonly part: BreakdownWrittenPart;
  /** How long the run took, in whole seconds; 0 for a part that was not run. */
  readonly seconds: number;
} & (
  | {
      readonly outcome: 'written';
      /** The engine that wrote it, and the ones passed over on the way. */
      readonly engine: EngineId;
      readonly skipped: readonly SkippedEngine[];
    }
  /** Kept from an earlier breakdown: nothing it was written from has changed. */
  | { readonly outcome: 'kept'; readonly engine: string }
  | { readonly outcome: 'failed'; readonly reason: string }
);

/** One part of a stored breakdown, as the page shows it. */
export interface BreakdownPartView {
  readonly id: BreakdownPartId;
  readonly title: string;
  /** 'missing': never written for this channel. */
  readonly state: 'written' | 'failed' | 'missing';
  /** The part's text without the prompt it marks; empty when the part is not written. */
  readonly body: string;
  /** The ready prompt lifted out from between its marker lines; null when the part holds none. */
  readonly prompt: string | null;
  /** Who wrote it: an engine by its id, or "jgtube" for what was worked out in code. */
  readonly engine: string | null;
  /** When it was written, or when writing it failed, as an ISO time. */
  readonly writtenAt: string | null;
  /** Why it could not be written. */
  readonly reason: string | null;
}

/** One of the four texts of a breakdown: whether there is one to download, or why not. */
export interface BreakdownFileView {
  readonly id: BreakdownFileId;
  readonly name: string;
  readonly available: boolean;
  readonly reason: string | null;
}

/** A channel's stored breakdown, as the page shows it. */
export interface BreakdownView {
  readonly channel: { readonly id: string; readonly title: string };
  /** When its newest part was written, as an ISO time; null when none is. */
  readonly writtenAt: string | null;
  /** Every part in the order it is read. */
  readonly parts: readonly BreakdownPartView[];
  readonly files: readonly BreakdownFileView[];
  /** The folder the text files were saved in; null when they are not on disk. */
  readonly folder: string | null;
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
  /** How many titles the title study rests on. */
  readonly titles: number;
  /** How writing each part went in this run, in order, with how long it took. */
  readonly parts: readonly PartRun[];
  /** The breakdown as it is now stored. */
  readonly breakdown: BreakdownView;
  /** Why the text files could not be saved, in plain words; null when they were. */
  readonly notSaved: string | null;
}

/** What the owner chose for one breakdown. */
export interface BreakdownChoices {
  /** The one engine for the frame studies and the parts; absent, the usual order with its backups. */
  readonly only?: EngineId | undefined;
  /** Make the watch notes and frame studies again, and write every part again, reusing nothing stored. */
  readonly fresh?: boolean | undefined;
}

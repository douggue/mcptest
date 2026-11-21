import type { VideoReportRow } from '@jgtube/core';
import type { Engine } from '@jgtube/server/src/app';

export type { CrawlChoices, CrawlOutcome, Engine, TransferChoices } from '@jgtube/server/src/app';
export type { VideoDetailsAnswer } from '@jgtube/server/src/downloadTypes';

export interface ChannelVideoRow extends VideoReportRow {
  readonly durationSeconds: number | null;
}

/** One stored channel and its videos with scores, strongest first and unscored last. */
export interface ChannelVideos {
  readonly channel: {
    readonly id: string;
    readonly title: string;
    readonly handle: string | null;
    readonly subscribers: number | null;
  };
  readonly videos: readonly ChannelVideoRow[];
}

/** The parts of the server's engine the connector uses; the engine may grow without touching it. */
type EngineParts = Pick<
  Engine,
  | 'findSnapshot'
  | 'findThumbnailBoard'
  | 'crawl'
  | 'setCompetitorStatus'
  | 'listNiches'
  | 'listTransfers'
  | 'readTranscript'
  | 'readVideoFrames'
  | 'readChannelBrand'
  | 'readVideoDetails'
  | 'findVideoStudy'
  | 'findIdeaBrief'
  | 'findConcept'
  | 'hookLibrary'
  | 'findScript'
>;

/** What the connector needs from the engine, so tests can stand in for it. */
export interface ConnectorEngine extends EngineParts {
  /** A stored channel's videos; reads the store only. Null when the channel is not stored. */
  findChannelVideos(channel: string): ChannelVideos | null;
}

/** One step of a long tool call, for clients that asked to be told. */
export interface ProgressUpdate {
  /** Counts upwards from 1; the protocol requires each update to be larger than the last. */
  readonly progress: number;
  readonly message: string;
}

export interface ToolContext {
  readonly reportProgress?: (update: ProgressUpdate) => void;
}

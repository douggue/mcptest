import type {
  BrandResult,
  DetailsProblem,
  ThumbnailDownload,
  TranscriptResult,
  VideoFacts,
  VideoFrames,
} from '@jgtube/core';

/** The description and tags of some videos beside their stored views and scores. */
export interface VideoDetailsAnswer {
  readonly videos: readonly VideoFacts[];
  /** The videos that could not be read, each with why. */
  readonly problems: readonly DetailsProblem[];
  /** Why the official API could not be used, when it was asked and refused. */
  readonly apiProblem: string | null;
}

/**
 * The part of the engine that downloads and reads closely: thumbnails to
 * disk, and one video's or one channel's own page. Each reads the store first
 * and asks YouTube only for what is missing. Kept apart from the rest of the
 * engine's interface so that the two can change separately.
 */
export interface DownloadsEngine {
  /**
   * Saves a stored channel's winning and ordinary thumbnails as image files
   * in the downloads folder, with an index. Null when the channel is not stored.
   */
  saveThumbnails(channel: string): Promise<ThumbnailDownload | null>;
  /** One video's captions, read once and then served from the store. */
  readTranscript(videoId: string): Promise<TranscriptResult>;
  /** Sheets of frames spread across one video; null when it has no storyboard. */
  readVideoFrames(videoId: string, sheets: number): Promise<VideoFrames | null>;
  /** A channel's logo, cover, bio, keywords and links; the channel is read when they are not stored. */
  readChannelBrand(channel: string): Promise<BrandResult>;
  /** The description and tags of the given videos, with their stored views and scores. */
  readVideoDetails(videoIds: readonly string[]): Promise<VideoDetailsAnswer>;
}

import type {
  BrandResult,
  BreakdownPartId,
  DetailsProblem,
  StoredBreakdownPart,
  StoredVideoStudy,
  StudyKind,
  ThumbnailDownload,
  TranscriptDownload,
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
  /**
   * Saves the transcripts of a stored channel's videos that took off as text
   * files in the downloads folder, with an index. Null when the channel is not stored.
   */
  saveTranscripts(channel: string): Promise<TranscriptDownload | null>;
  /** One video's captions, read once and then served from the store. */
  readTranscript(videoId: string): Promise<TranscriptResult>;
  /**
   * Sheets of frames of one video: spread across it, or, with `from`, in a
   * row starting at that sheet (numbered from 0). Frames cut from the video's
   * file are served when Jgtube has cut them; otherwise YouTube's preview
   * frames. Null when there are neither.
   */
  readVideoFrames(videoId: string, sheets: number, from?: number): Promise<VideoFrames | null>;
  /**
   * What an engine wrote down about one video ('watch' or 'frames'); reads
   * the store only. Null when there is no such study.
   */
  findVideoStudy(videoId: string, kind: StudyKind): StoredVideoStudy | null;
  /** A video's stored length in seconds; reads the store only. Null when it is not stored. */
  findVideoSeconds(videoId: string): number | null;
  /**
   * One stored part of a channel's breakdown; reads the store only. Null
   * when the channel is not stored or that part was never written for it.
   */
  findBreakdownPart(channel: string, part: BreakdownPartId): StoredBreakdownPart | null;
  /** A channel's logo, cover, bio, keywords and links; the channel is read when they are not stored. */
  readChannelBrand(channel: string): Promise<BrandResult>;
  /** The description and tags of the given videos, with their stored views and scores. */
  readVideoDetails(videoIds: readonly string[]): Promise<VideoDetailsAnswer>;
}

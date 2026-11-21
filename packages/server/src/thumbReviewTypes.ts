/** The per-video thumbnail review as the API sees it. */
import type { CountRow, CompareThumb, TagRejection, ThumbTags } from '@jgtube/core';
import type { EngineId } from './engines/types';

/** A video the owner can pick for a review. */
export interface PickableVideo {
  readonly videoId: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelTitle: string;
  /** Multiple of its channel's usual views; null when it cannot be judged yet. */
  readonly score: number | null;
  readonly ageDays: number;
}

export interface PickableVideos {
  /** The owner's own stored videos, newest first. */
  readonly own: readonly PickableVideo[];
  /** The winners of the map's other channels, strongest first. */
  readonly map: readonly PickableVideo[];
  /** Videos with a kept review, newest first. */
  readonly reviewed: readonly string[];
}

/** A kept review, as plain values. */
export interface ThumbReviewView {
  readonly target: PickableVideo & { readonly tags: ThumbTags | null };
  readonly winners: readonly CompareThumb[];
  readonly ordinary: readonly CompareThumb[];
  readonly rows: readonly CountRow[];
  readonly winnersTagged: number;
  readonly ordinaryTagged: number;
  readonly channels: number;
  readonly rejected: readonly TagRejection[];
  readonly comparedAt: string;
  readonly answer: {
    readonly text: string;
    readonly prompt: string | null;
    readonly engine: string;
    readonly writtenAt: string;
  } | null;
}

export interface ThumbReviewOutcome {
  readonly winners: number;
  readonly tagged: number;
  readonly rejected: number;
  readonly engine: string;
}

export interface ThumbReviewEngine {
  /** The videos a review can be asked for; null when the channel has no map. Reads the store only. */
  thumbnailVideos(centerChannelId: string): PickableVideos | null;
  /** A video's kept review; null when there is none. Reads the store only. */
  findThumbnailReview(centerChannelId: string, videoId: string): ThumbReviewView | null;
  /**
   * Chooses the winners to compare with, has the thumbnails not yet tagged
   * tagged, counts in code and has an engine write the advice from the count.
   * Rejects with a plain message when the video is not on the map or nothing
   * could be compared.
   */
  askThumbnailReview(
    centerChannelId: string,
    videoId: string,
    only?: EngineId,
    report?: (text: string) => void,
  ): Promise<ThumbReviewOutcome>;
  /** The counted comparison as the connector's tool gives it; null when none is kept. */
  thumbnailComparison(centerChannelId: string, videoId: string): string | null;
}

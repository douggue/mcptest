import type { CommentsResult, FetchedComment } from '../sources/commentsApi';
import type { ViewerFinding } from './findings';

export type StoredComment = FetchedComment;

/** When a video's comments were read, and how it went. */
export interface CommentRead {
  readonly status: CommentsResult['status'];
  readonly count: number;
  readonly readAt: Date;
}

/** A channel's latest "What viewers ask for", as checked in code. */
export interface ViewerAnswer {
  readonly videoIds: readonly string[];
  readonly findings: readonly ViewerFinding[];
  readonly engine: string;
  readonly askedAt: Date;
}

export interface CommentRepo {
  /** Replaces a video's stored comments with those of a new read. */
  saveRead(videoId: string, result: CommentsResult, at: Date): void;
  /** What is known of each video's comments; videos never read are left out. */
  reads(videoIds: readonly string[]): ReadonlyMap<string, CommentRead>;
  /** The videos' stored comments, most liked first. */
  listForVideos(videoIds: readonly string[]): readonly StoredComment[];
  findAnswer(centerChannelId: string): ViewerAnswer | null;
  saveAnswer(centerChannelId: string, answer: ViewerAnswer): void;
}

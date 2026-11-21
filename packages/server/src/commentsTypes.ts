/**
 * Comment mining as the API sees it: the winning videos of one centre
 * channel's map, their comments read with the owner's API key, and "What
 * viewers ask for" as checked in code. Times are ISO-8601.
 */
import type { FindingKind, MineOutcome } from '@jgtube/core';
import type { EngineId } from './engines/types';

export interface CandidateView {
  readonly videoId: string;
  readonly title: string;
  readonly channelTitle: string;
  readonly score: number;
  readonly views: number;
  /** What is known of its comments; null when they were never read. */
  readonly read: {
    readonly status: 'read' | 'disabled';
    readonly count: number;
    readonly readAt: string;
  } | null;
}

export interface QuotedComment {
  readonly commentId: string;
  readonly videoId: string;
  readonly text: string;
  readonly likes: number;
}

export interface FindingView {
  readonly kind: FindingKind;
  readonly says: string;
  /** The stored comments it rests on, as they were read; never the engine's quoting of them. */
  readonly comments: readonly QuotedComment[];
}

export interface CommentsView {
  readonly centerChannelId: string;
  /** Whether the owner has set a YouTube API key; read at the time of asking. */
  readonly keySet: boolean;
  readonly unitsPerVideo: number;
  readonly maxVideos: number;
  /** A key's default daily allowance, in units. */
  readonly dailyUnits: number;
  readonly candidates: readonly CandidateView[];
  readonly answer: {
    readonly videoIds: readonly string[];
    readonly findings: readonly FindingView[];
    readonly engine: string;
    readonly askedAt: string;
  } | null;
}

/** What the connector tool hands an engine: winners of the map and their stored comments. */
export interface ToolComments {
  readonly videos: readonly {
    readonly videoId: string;
    readonly title: string;
    readonly channelTitle: string;
    readonly comments: readonly {
      readonly id: string;
      readonly text: string;
      readonly likes: number;
    }[];
  }[];
}

export interface ViewerAskOutcome {
  /** Findings in the answer, and those dropped for quoting too few comments that were handed out. */
  readonly proposed: number;
  readonly dropped: number;
  /** Blocks of the answer not in the form asked for. */
  readonly unread: number;
  readonly engine: string;
}

export interface CommentsEngine {
  /** Reads the store only; null when the channel has no map. */
  findComments(centerChannelId: string): CommentsView | null;
  /** Reads the chosen winners' comments with the owner's key; throws when it cannot start. */
  readComments(
    centerChannelId: string,
    videoIds: readonly string[],
    onProgress: (done: number, total: number) => void,
  ): Promise<readonly MineOutcome[]>;
  /** Asks one AI question about the chosen winners' stored comments and keeps the checked answer. */
  askViewers(
    centerChannelId: string,
    videoIds: readonly string[],
    only?: EngineId,
  ): Promise<ViewerAskOutcome>;
  /** For the connector tool; null when the channel has no map. */
  viewerComments(centerChannelId: string, videoIds: readonly string[]): ToolComments | null;
}

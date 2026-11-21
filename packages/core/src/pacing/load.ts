import { lookalikeHistories, type HistoryDeps } from '../changes/load';
import {
  DEFAULT_BREAKOUT_WINDOW_DAYS,
  DEFAULT_MIN_BREAKOUT_SCORE,
  MAX_BREAKOUTS_PER_CHANNEL,
} from '../map/breakouts';
import type { TranscriptRepo } from '../repos/types';
import { comparePacing, winnerVideos, type PacingComparison } from './compare';

export type PacingDeps = HistoryDeps & { readonly transcripts: Pick<TranscriptRepo, 'find'> };

export interface PacingView extends PacingComparison {
  readonly centerChannelId: string;
  /** Which of the look-alikes' videos count as winners. */
  readonly rule: {
    readonly minScore: number;
    readonly windowDays: number;
    readonly perChannel: number;
  };
  /** The look-alikes on the map the winners were taken from. */
  readonly lookalikes: number;
}

/** A channel's own lengths and pace beside its map's breakouts; null when it has no map. */
export function loadPacing(
  deps: PacingDeps,
  centerChannelId: string,
  now: Date,
): PacingView | null {
  const found = lookalikeHistories(deps, centerChannelId, now);
  if (!found) return null;
  const comparison = comparePacing({
    own: deps.videos.listByChannel(centerChannelId),
    winners: winnerVideos(found.histories, now),
    transcriptOf: (videoId) => deps.transcripts.find(videoId)?.transcript ?? null,
  });
  return {
    centerChannelId,
    ...comparison,
    rule: {
      minScore: DEFAULT_MIN_BREAKOUT_SCORE,
      windowDays: DEFAULT_BREAKOUT_WINDOW_DAYS,
      perChannel: MAX_BREAKOUTS_PER_CHANNEL,
    },
    lookalikes: found.histories.length,
  };
}

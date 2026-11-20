import type { BoardCenter, BoardChannel, ThumbnailBoard } from '@jgtube/core';

/** 'compare' sets each channel's winners beside its ordinary videos; 'winners' shows winners alone. */
export type BoardMode = 'compare' | 'winners';

export const BOARD_MODES: readonly { readonly id: BoardMode; readonly label: string }[] = [
  { id: 'compare', label: 'Winners next to ordinary' },
  { id: 'winners', label: 'Winners only' },
];

export interface BoardTotals {
  readonly channels: number;
  readonly winners: number;
  readonly ordinary: number;
}

/** How many channels and thumbnails the board holds. */
export function boardTotals(board: ThumbnailBoard): BoardTotals {
  const count = (pick: (channel: BoardChannel) => readonly unknown[]): number =>
    board.channels.reduce((sum, channel) => sum + pick(channel).length, 0);
  return {
    channels: board.channels.length,
    winners: count((channel) => channel.winners),
    ordinary: count((channel) => channel.ordinary),
  };
}

/** In words, how often a channel's videos go far above its usual views. */
export function describeHitRate(channel: BoardChannel): string {
  if (channel.scoredCount === 0) return 'Too few videos to judge yet';
  const noun = channel.scoredCount === 1 ? 'video' : 'videos';
  return `${channel.winnerCount} of ${channel.scoredCount} ${noun} took off`;
}

/** Whose thumbnails the owner's own row holds, and how many. */
export function describeOwn(center: BoardCenter): string {
  const count = center.videos.length;
  if (count === 0) return center.title;
  return `${center.title} · your ${count === 1 ? 'newest video' : `${count} newest videos`}`;
}

/** 'winner' is drawn in amber, 'plain' in a muted badge, and 'none' has no score to show. */
export type ScoreTone = 'winner' | 'plain' | 'none';

export function scoreTone(
  score: number | null,
  board: Pick<ThumbnailBoard, 'winnerMinScore'>,
): ScoreTone {
  if (score === null) return 'none';
  return score >= board.winnerMinScore ? 'winner' : 'plain';
}

import { buildVideoReport } from '../report';
import type { MapMemberData } from './view';

export const DEFAULT_BREAKOUT_WINDOW_DAYS = 30;
export const DEFAULT_MIN_BREAKOUT_SCORE = 2;
export const DEFAULT_BREAKOUT_LIMIT = 60;

export interface BreakoutVideo {
  readonly videoId: string;
  readonly title: string;
  readonly views: number;
  readonly ageDays: number;
  /** The relative date as YouTube gave it, such as "2w ago". */
  readonly publishedRaw: string;
  readonly durationSeconds: number | null;
  /** Multiple of the channel's usual views at this age. */
  readonly score: number;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly channelSubscribers: number | null;
}

export interface BreakoutOptions {
  readonly windowDays?: number;
  readonly minScore?: number;
  readonly limit?: number;
}

/** Recent videos across the map that are far above their channel's usual views, strongest first. */
export function listBreakouts(
  members: readonly MapMemberData[],
  now: Date,
  options: BreakoutOptions = {},
): readonly BreakoutVideo[] {
  const windowDays = options.windowDays ?? DEFAULT_BREAKOUT_WINDOW_DAYS;
  const minScore = options.minScore ?? DEFAULT_MIN_BREAKOUT_SCORE;

  const candidates = members.flatMap((member) => {
    const durations = new Map(member.videos.map((video) => [video.id, video.durationSeconds]));
    return buildVideoReport(member.videos, now).flatMap((row): BreakoutVideo[] =>
      row.score !== null && row.score >= minScore && row.ageDays <= windowDays
        ? [
            {
              videoId: row.id,
              title: row.title,
              views: row.views,
              ageDays: row.ageDays,
              publishedRaw: row.publishedRaw,
              durationSeconds: durations.get(row.id) ?? null,
              score: row.score,
              channelId: member.channel.id,
              channelTitle: member.channel.title,
              channelSubscribers: member.channel.subscribers,
            },
          ]
        : [],
    );
  });

  return [...candidates]
    .sort((a, b) => b.score - a.score || b.views - a.views)
    .slice(0, options.limit ?? DEFAULT_BREAKOUT_LIMIT);
}

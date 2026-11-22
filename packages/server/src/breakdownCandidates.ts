/**
 * What the breakdown view shows of each channel the owner could break down,
 * from the store alone: its logo, size, how many of its videos are breaking
 * out now, its best videos and when it was last broken down. Ranking them is
 * the page's (`lib/breakdownPicks.ts`); every number here is counted from
 * stored videos.
 */
import {
  DEFAULT_BREAKOUT_WINDOW_DAYS,
  DEFAULT_MIN_BREAKOUT_SCORE,
  LOGO_SHOWN_MIN_WIDTH,
  buildVideoReport,
  pickImage,
  type BrandRepo,
  type BreakdownRepo,
  type ChannelRepo,
  type StoredChannel,
  type VideoRepo,
} from '@jgtube/core';

/** The best videos shown on a channel's row. */
export const CANDIDATE_TOP_VIDEOS = 3;
/** The most channels asked about at once: the largest map and the owner's lists fit. */
export const MAX_CANDIDATES = 800;

export interface CandidateVideo {
  readonly videoId: string;
  readonly title: string;
  /** Multiple of the channel's usual views; null when it cannot be judged. */
  readonly score: number | null;
}

export interface CandidateFacts {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  readonly logoUrl: string | null;
  /** Null when the channel hides its count. */
  readonly subscribers: number | null;
  readonly storedVideos: number;
  /** Videos of the last `DEFAULT_BREAKOUT_WINDOW_DAYS` days at `DEFAULT_MIN_BREAKOUT_SCORE` times usual or more: the feed's own rule. */
  readonly breakingOut: number;
  /** The best score among those recent videos; null when none scored. */
  readonly recentBest: number | null;
  /** The channel's best videos by score, best first. */
  readonly top: readonly CandidateVideo[];
  /** When its breakdown was last written, as an ISO-8601 string; null when never. */
  readonly brokenDownAt: string | null;
}

export interface CandidateDeps {
  readonly channels: Pick<ChannelRepo, 'findById'>;
  readonly videos: Pick<VideoRepo, 'listByChannel'>;
  readonly brands: Pick<BrandRepo, 'find'>;
  readonly breakdowns: Pick<BreakdownRepo, 'list'>;
  readonly now: () => Date;
}

/** When a channel's breakdown was last written; parts that failed count, as a run did happen. */
function lastBrokenDown(deps: CandidateDeps, channelId: string): string | null {
  const times = deps.breakdowns.list(channelId).map((part) => part.writtenAt.getTime());
  return times.length === 0 ? null : new Date(Math.max(...times)).toISOString();
}

/** One stored channel as the breakdown view shows it. */
export function candidateOf(deps: CandidateDeps, channel: StoredChannel): CandidateFacts {
  const videos = deps.videos.listByChannel(channel.id);
  const report = buildVideoReport(videos, deps.now());
  const recent = report.filter(
    (row) => row.score !== null && row.ageDays <= DEFAULT_BREAKOUT_WINDOW_DAYS,
  );
  const breaking = recent.filter((row) => (row.score ?? 0) >= DEFAULT_MIN_BREAKOUT_SCORE);
  const logo = pickImage(deps.brands.find(channel.id)?.avatar ?? [], LOGO_SHOWN_MIN_WIDTH);
  return {
    id: channel.id,
    title: channel.title,
    handle: channel.handle,
    logoUrl: logo?.url ?? null,
    subscribers: channel.subscribersHidden ? null : channel.subscribers,
    storedVideos: videos.length,
    breakingOut: breaking.length,
    recentBest: recent[0]?.score ?? null,
    top: report
      .slice(0, CANDIDATE_TOP_VIDEOS)
      .map((row) => ({ videoId: row.id, title: row.title, score: row.score })),
    brokenDownAt: lastBrokenDown(deps, channel.id),
  };
}

/** The stored channels among those asked about, in the order asked; ones not stored are left out. */
export function breakdownCandidates(
  deps: CandidateDeps,
  ids: readonly string[],
): readonly CandidateFacts[] {
  return [...new Set(ids)].flatMap((id) => {
    const channel = deps.channels.findById(id);
    return channel === null ? [] : [candidateOf(deps, channel)];
  });
}

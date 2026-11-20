import type { BoardChannel, BoardVideo, ThumbnailBoard } from '@jgtube/core';
import { capped, oneDecimal, withoutAbsent } from './results';
import type { ChannelVideoRow, ChannelVideos } from './types';

export interface BoardSummaryOptions {
  /** Most look-alike channels listed. */
  readonly channels: number;
  /** Most winners, and most ordinary videos, per channel. */
  readonly perChannel: number;
}

export interface ChannelVideosOptions {
  readonly order: 'strongest' | 'newest';
  readonly limit: number;
}

function boardVideo(video: BoardVideo): Record<string, unknown> {
  return withoutAbsent({
    video: video.videoId,
    title: video.title,
    views: video.views,
    score: video.score === null ? null : oneDecimal(video.score),
  });
}

function boardChannel(channel: BoardChannel, perChannel: number): Record<string, unknown> {
  return withoutAbsent({
    id: channel.id,
    title: channel.title,
    subs: channel.subscribers,
    winnerCount: channel.winnerCount,
    scoredCount: channel.scoredCount,
    winners: channel.winners.slice(0, perChannel).map(boardVideo),
    ordinary: channel.ordinary.slice(0, perChannel).map(boardVideo),
  });
}

/**
 * The thumbnail board as ids and numbers: for each look-alike channel with at
 * least one winner, what worked beside what did not, and the owner's own videos.
 */
export function summarizeBoard(
  board: ThumbnailBoard,
  options: BoardSummaryOptions,
): Record<string, unknown> {
  const { center } = board;
  // A channel with no winner has nothing to copy; it is counted, not listed.
  const withWinners = board.channels.filter((channel) => channel.winners.length > 0);
  const withoutWinners = board.channels.length - withWinners.length;
  const { shown, more } = capped(withWinners, options.channels);

  return {
    winnerMinScore: board.winnerMinScore,
    ordinaryMaxScore: board.ordinaryMaxScore,
    own: withoutAbsent({
      id: center.id,
      title: center.title,
      subs: center.subscribers,
      videos: center.videos.map(boardVideo),
    }),
    channels: shown.map((channel) => boardChannel(channel, options.perChannel)),
    ...(more > 0 ? { moreChannels: more } : {}),
    ...(withoutWinners > 0 ? { channelsWithoutWinners: withoutWinners } : {}),
  };
}

function videoEntry(row: ChannelVideoRow): Record<string, unknown> {
  return withoutAbsent({
    video: row.id,
    title: row.title,
    views: row.views,
    score: row.score === null ? null : oneDecimal(row.score),
    usual: row.baseline === null ? null : Math.round(row.baseline),
    sample: row.sampleSize,
    ageDays: Math.round(row.ageDays),
    published: row.publishedRaw,
    secs: row.durationSeconds,
  });
}

/** One channel's videos with scores, in the order asked for. */
export function summarizeChannelVideos(
  found: ChannelVideos,
  options: ChannelVideosOptions,
): Record<string, unknown> {
  const { channel, videos } = found;
  const ordered =
    options.order === 'newest' ? [...videos].sort((a, b) => a.ageDays - b.ageDays) : videos;
  const { shown, more } = capped(ordered, options.limit);
  return {
    channel: withoutAbsent({
      id: channel.id,
      title: channel.title,
      handle: channel.handle,
      subs: channel.subscribers,
    }),
    stored: videos.length,
    shown: shown.length,
    ...(more > 0 ? { more } : {}),
    videos: shown.map(videoEntry),
  };
}

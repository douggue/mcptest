import { DEFAULT_MAX_VIDEOS } from '../ingest';
import { buildVideoReport, type VideoReportRow } from '../report';
import { RECENT_WINDOW_DAYS } from '../scoring/outlier';
import type { MapMemberData } from './view';

export const DEFAULT_BREAKOUT_WINDOW_DAYS = 30;
export const DEFAULT_MIN_BREAKOUT_SCORE = 2;
export const DEFAULT_BREAKOUT_LIMIT = 60;
/**
 * The most videos one channel may hold in a feed. A channel with a series that
 * is working would otherwise fill the feed with one idea. Four is enough to
 * show that it is a series and not one lucky video, and keeps a full feed at
 * least fifteen channels wide. It is also how many winners the thumbnail board
 * shows for a channel.
 */
export const MAX_BREAKOUTS_PER_CHANNEL = 4;
/** A baseline taken from fewer videos than this moves too easily to lean on. */
export const THIN_SAMPLE_SIZE = 5;
/** Below this many usual views, a large multiple is still a small number of people. */
export const THIN_BASELINE_VIEWS = 500;

/**
 * 'few-videos': the usual was taken from too few videos to be steady.
 * 'low-baseline': the usual is so small that a large multiple is still few people.
 */
export type ScoreCaution = 'few-videos' | 'low-baseline';

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
  /** The channel's usual views: the median of its other recent videos. */
  readonly baseline: number;
  /** How many other videos that median was taken from. */
  readonly sampleSize: number;
  /** Of the channel's scored videos from the last 90 days, how many broke out. */
  readonly channelHits: number;
  readonly channelScored: number;
  /** Days since the channel's oldest video; null when older ones may not have been read. */
  readonly channelAgeDays: number | null;
  /** Why the score should be read with care, if it should. */
  readonly caution: ScoreCaution | null;
}

export interface BreakoutOptions {
  readonly windowDays?: number;
  readonly minScore?: number;
  readonly limit?: number;
}

/**
 * The list with each channel's videos after its first `most` left out, in the
 * order given: on a list sorted strongest first, each channel keeps its
 * strongest. The list passed in is not changed.
 */
export function capPerChannel<T extends { readonly channelId: string }>(
  videos: readonly T[],
  most: number = MAX_BREAKOUTS_PER_CHANNEL,
): readonly T[] {
  const taken = new Map<string, number>();
  return videos.filter((video) => {
    const count = (taken.get(video.channelId) ?? 0) + 1;
    taken.set(video.channelId, count);
    return count <= most;
  });
}

export function cautionFor(sampleSize: number, baseline: number): ScoreCaution | null {
  if (sampleSize < THIN_SAMPLE_SIZE) return 'few-videos';
  return baseline < THIN_BASELINE_VIEWS ? 'low-baseline' : null;
}

interface ChannelEvidence {
  readonly channelHits: number;
  readonly channelScored: number;
  readonly channelAgeDays: number | null;
}

/** How often a channel breaks out and how long it has been publishing. */
function channelEvidence(
  report: readonly VideoReportRow[],
  storedVideos: number,
  minScore: number,
): ChannelEvidence {
  const scored = report.filter((row) => row.score !== null && row.ageDays <= RECENT_WINDOW_DAYS);
  // Hitting the fetch cap means older videos may exist that were never read.
  const sawWholeChannel = storedVideos > 0 && storedVideos < DEFAULT_MAX_VIDEOS;
  return {
    channelHits: scored.filter((row) => (row.score ?? 0) >= minScore).length,
    channelScored: scored.length,
    channelAgeDays: sawWholeChannel ? Math.max(0, ...report.map((row) => row.ageDays)) : null,
  };
}

/**
 * Recent videos across the map that are far above their channel's usual views,
 * strongest first. No channel holds more than `MAX_BREAKOUTS_PER_CHANNEL`
 * places; the places that frees go to the next strongest videos of the others.
 */
export function listBreakouts(
  members: readonly MapMemberData[],
  now: Date,
  options: BreakoutOptions = {},
): readonly BreakoutVideo[] {
  const windowDays = options.windowDays ?? DEFAULT_BREAKOUT_WINDOW_DAYS;
  const minScore = options.minScore ?? DEFAULT_MIN_BREAKOUT_SCORE;

  const candidates = members.flatMap((member) => {
    const durations = new Map(member.videos.map((video) => [video.id, video.durationSeconds]));
    const report = buildVideoReport(member.videos, now);
    const evidence = channelEvidence(report, member.videos.length, minScore);
    return report.flatMap((row): BreakoutVideo[] =>
      row.score !== null &&
      row.baseline !== null &&
      row.sampleSize !== null &&
      row.score >= minScore &&
      row.ageDays <= windowDays
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
              baseline: row.baseline,
              sampleSize: row.sampleSize,
              ...evidence,
              caution: cautionFor(row.sampleSize, row.baseline),
            },
          ]
        : [],
    );
  });

  const strongestFirst = [...candidates].sort((a, b) => b.score - a.score || b.views - a.views);
  return capPerChannel(strongestFirst).slice(0, options.limit ?? DEFAULT_BREAKOUT_LIMIT);
}

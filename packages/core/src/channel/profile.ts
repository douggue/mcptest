/**
 * One channel as the store holds it: its own numbers, how often it uploads,
 * how many of its videos broke out, and some of its videos. Every number is
 * stored or computed here from stored videos; nothing is forecast.
 */
import { DEFAULT_MAX_VIDEOS } from '../ingest';
import { DEFAULT_BREAKOUT_WINDOW_DAYS, DEFAULT_MIN_BREAKOUT_SCORE } from '../map/breakouts';
import { buildVideoReport, type VideoReportRow } from '../report';
import type { BrandRepo, ChannelRepo, MapRepo, StoredVideo, VideoRepo } from '../repos/types';
import { LOGO_SHOWN_MIN_WIDTH, pickImage } from './brand';

/** How many videos each list of the profile holds. */
export const PROFILE_VIDEOS = 8;
const MONTH_DAYS = 30;
const QUARTER_DAYS = 90;
const WEEK_DAYS = 7;

export interface ProfileDeps {
  readonly channels: Pick<ChannelRepo, 'findById'>;
  readonly videos: Pick<VideoRepo, 'listByChannel'>;
  readonly maps: Pick<MapRepo, 'latestForCenter'>;
  readonly brands?: Pick<BrandRepo, 'find'>;
}

export interface ProfileVideo {
  readonly videoId: string;
  readonly title: string;
  readonly views: number;
  readonly ageDays: number;
  /** The date as YouTube gave it, such as "2 weeks ago". */
  readonly publishedRaw: string;
  readonly durationSeconds: number | null;
  /** Multiple of the channel's usual views at this age; null when it cannot be judged. */
  readonly score: number | null;
}

export interface ChannelProfile {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  /** Null when the channel hides the count or it was never read. */
  readonly subscribers: number | null;
  readonly subscribersHidden: boolean;
  /** The number of videos YouTube lists for the channel; null when it did not say. */
  readonly videoCount: number | null;
  readonly logoUrl: string | null;
  /** When the channel was last read, as an ISO-8601 string. */
  readonly readAt: string;
  /** Whether a map has been made with this channel at its centre. */
  readonly hasMap: boolean;
  /** The videos the store holds, and their views added up. */
  readonly stored: {
    readonly videos: number;
    readonly views: number;
    /** The reader keeps only the newest videos; older ones may exist that are not stored. */
    readonly capped: boolean;
  };
  readonly uploads: {
    readonly last30Days: number;
    readonly last90Days: number;
    /** Uploads a week over the last 90 days, to one decimal. */
    readonly perWeek: number;
  };
  readonly lastUpload: { readonly ageDays: number; readonly publishedRaw: string } | null;
  /** Stored videos with a score of at least `minScore`: all of them, and those of the last `windowDays`. */
  readonly outliers: {
    readonly minScore: number;
    readonly windowDays: number;
    readonly all: number;
    readonly recent: number;
  };
  /** The newest stored videos. */
  readonly recent: readonly ProfileVideo[];
  /** The strongest outliers, strongest first. */
  readonly top: readonly ProfileVideo[];
}

const toVideo =
  (byId: ReadonlyMap<string, StoredVideo>) =>
  (row: VideoReportRow): ProfileVideo => ({
    videoId: row.id,
    title: row.title,
    views: row.views,
    ageDays: Math.round(row.ageDays),
    publishedRaw: row.publishedRaw,
    durationSeconds: byId.get(row.id)?.durationSeconds ?? null,
    score: row.score,
  });

const within = (rows: readonly VideoReportRow[], days: number): number =>
  rows.filter((row) => row.ageDays <= days).length;

/** What the stored videos say: uploads, outliers and the two lists. */
function videoNumbers(videos: readonly StoredVideo[], now: Date) {
  const report = buildVideoReport(videos, now);
  const shown = toVideo(new Map(videos.map((video) => [video.id, video])));
  const newest = [...report].sort((a, b) => a.ageDays - b.ageDays);
  const outliers = report.filter((row) => (row.score ?? 0) >= DEFAULT_MIN_BREAKOUT_SCORE);
  const last90Days = within(report, QUARTER_DAYS);
  const latest = newest[0];
  return {
    uploads: {
      last30Days: within(report, MONTH_DAYS),
      last90Days,
      perWeek: Math.round(((last90Days * WEEK_DAYS) / QUARTER_DAYS) * 10) / 10,
    },
    lastUpload: latest
      ? { ageDays: Math.round(latest.ageDays), publishedRaw: latest.publishedRaw }
      : null,
    outliers: {
      minScore: DEFAULT_MIN_BREAKOUT_SCORE,
      windowDays: DEFAULT_BREAKOUT_WINDOW_DAYS,
      all: outliers.length,
      recent: within(outliers, DEFAULT_BREAKOUT_WINDOW_DAYS),
    },
    recent: newest.slice(0, PROFILE_VIDEOS).map(shown),
    top: outliers.slice(0, PROFILE_VIDEOS).map(shown),
  };
}

/** A stored channel's profile; null when the store does not hold the channel. */
export function loadChannelProfile(
  deps: ProfileDeps,
  channelId: string,
  now: Date,
): ChannelProfile | null {
  const channel = deps.channels.findById(channelId);
  if (!channel) return null;
  const videos = deps.videos.listByChannel(channelId);
  const logo = pickImage(deps.brands?.find(channelId)?.avatar ?? [], LOGO_SHOWN_MIN_WIDTH);
  return {
    id: channel.id,
    title: channel.title,
    handle: channel.handle,
    subscribers: channel.subscribersHidden ? null : channel.subscribers,
    subscribersHidden: channel.subscribersHidden,
    videoCount: channel.videoCount,
    logoUrl: logo?.url ?? null,
    readAt: channel.fetchedAt.toISOString(),
    hasMap: deps.maps.latestForCenter(channelId) !== null,
    stored: {
      videos: videos.length,
      views: videos.reduce((sum, video) => sum + video.views, 0),
      capped: videos.length >= DEFAULT_MAX_VIDEOS,
    },
    ...videoNumbers(videos, now),
  };
}

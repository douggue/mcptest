import { DEFAULT_MAX_VIDEOS } from '../ingest';
import { PEER_MAX_UPLOADS_PER_WEEK, medianDurationSeconds, uploadsPerWeek } from '../map/peers';
import type { BoardVideo } from '../map/thumbnails';
import { RECENT_DAYS } from '../map/view';
import { buildVideoReport, type VideoReportRow } from '../report';
import { estimateEarnings, type EarningsEstimate } from '../scoring/earnings';
import type {
  ChannelRepo,
  MapRepo,
  StoredChannel,
  StoredVideo,
  VideoRepo,
  WatchlistRepo,
} from '../repos/types';
import { hitRate, isOutperformer } from './outperform';
import { NICHE_MIN_LATIN_SHARE, latinShare } from './script';

/**
 * New niches to watch: channels anywhere in the store that are new or small
 * and have a recent video that outperforms. A crawl reads hundreds of channels
 * and a map shows only the ones like the centre; this keeps the rest from
 * being thrown away.
 */

/**
 * A channel is new when its first upload is this recent. The first upload is
 * used, not the account's creation date: accounts are often years older than
 * the channel that restarted on them.
 */
export const NICHE_NEW_MAX_AGE_DAYS = 90;
/**
 * A channel at or under this is small, whatever its age. It is the line the
 * breakout feed already draws ("Under 10K"). Below it a channel has too few
 * subscribers to carry a video on its own, so one that takes off did so on its
 * topic and packaging, which is what the owner can copy.
 */
export const NICHE_SMALL_MAX_SUBSCRIBERS = 10_000;
/**
 * No channel above this is listed, new or not. 100,000 is where YouTube itself
 * stops calling a channel small (its first creator award); a channel under 90
 * days old that is already past it is an established brand's new outlet. On
 * the owner's store the largest new channel under it has 29,900 subscribers
 * and the next one up has 876,000.
 */
export const NICHE_MAX_SUBSCRIBERS = 100_000;
/** Above this a channel is cutting clips, not making videos; the same line the peer rules draw. */
export const NICHE_MAX_UPLOADS_PER_WEEK = PEER_MAX_UPLOADS_PER_WEEK;
/** A channel whose usual upload runs over an hour is re-posting films or streams. */
export const NICHE_MAX_MEDIAN_DURATION_SECONDS = 60 * 60;

/** Newest titles per channel that the alphabet check reads. */
const TITLES_CHECKED = 30;
const SAMPLE_TITLES = 3;
const OUTPERFORMERS_SHOWN = 3;

/** 'new': first upload in the last 90 days. 'small': 10,000 subscribers or fewer. */
export type NicheReason = 'new' | 'small';

export interface NicheSample {
  readonly videoId: string;
  readonly title: string;
  readonly views: number;
}

export interface NicheChannel {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  /** Null when the channel hides its count. */
  readonly subscribers: number | null;
  /** Views on videos uploaded in the last 30 days. Not the same as views in the last 30 days. */
  readonly recentViews: number;
  readonly recentUploads: number;
  /** `recentViews` for each subscriber; null when the count is hidden or zero. */
  readonly viewsPerSubscriber: number | null;
  /**
   * What the views on the last 30 days' uploads are worth in ad revenue: a
   * rough monthly range for comparing channels, not a measurement.
   */
  readonly earnings: EarningsEstimate;
  /** Days since the channel's first upload; null when older videos may not have been read. */
  readonly channelAgeDays: number | null;
  /** Which of new and small the channel is; both when it is both. */
  readonly reasons: readonly NicheReason[];
  /** Its recent videos that outperform, most viewed first; a few at most. */
  readonly outperformers: readonly BoardVideo[];
  /** Of its scored videos from the last 90 days, how many were strong outliers. */
  readonly hitCount: number;
  readonly scoredCount: number;
  /** Its most viewed uploads of the last 30 days. */
  readonly sampleTitles: readonly NicheSample[];
  /** False only on a watched channel that no longer meets the rule. */
  readonly qualifies: boolean;
  /** The owner marked it to keep an eye on. */
  readonly watched: boolean;
}

/** Plain values, ready to serialise. */
export interface NicheList {
  /** Most views on recent uploads first. */
  readonly channels: readonly NicheChannel[];
  /** How many stored channels were gone through. */
  readonly channelsChecked: number;
  /** The limits the list was made with, so a reader can say what new and small mean. */
  readonly smallMaxSubscribers: number;
  readonly newMaxAgeDays: number;
}

/** A stored channel with its videos, newest first. */
export interface NicheSource {
  readonly channel: StoredChannel;
  readonly videos: readonly StoredVideo[];
}

export interface NicheInput {
  readonly sources: readonly NicheSource[];
  readonly watchedIds: ReadonlySet<string>;
  /** Channels never offered as a niche: the ones the owner maps from. */
  readonly excludedIds: ReadonlySet<string>;
}

function channelAgeDays(report: readonly VideoReportRow[]): number | null {
  // Hitting the fetch cap means older videos may exist that were never read.
  const sawWholeChannel = report.length > 0 && report.length < DEFAULT_MAX_VIDEOS;
  return sawWholeChannel ? Math.max(...report.map((row) => row.ageDays)) : null;
}

function reasonsFor(subscribers: number | null, ageDays: number | null): readonly NicheReason[] {
  return [
    ...(ageDays !== null && ageDays <= NICHE_NEW_MAX_AGE_DAYS ? (['new'] as const) : []),
    // A hidden count cannot be shown to be small.
    ...(subscribers !== null && subscribers <= NICHE_SMALL_MAX_SUBSCRIBERS
      ? (['small'] as const)
      : []),
  ];
}

/**
 * Whether a channel is a large institution, a clip or film re-poster, or in
 * another alphabet: none of which the owner could learn a niche from.
 */
function isJunk(source: NicheSource, now: Date): boolean {
  const { channel, videos } = source;
  if (channel.subscribers !== null && channel.subscribers > NICHE_MAX_SUBSCRIBERS) return true;
  if (uploadsPerWeek(videos, now) > NICHE_MAX_UPLOADS_PER_WEEK) return true;
  const usualLength = medianDurationSeconds(videos);
  if (usualLength !== null && usualLength > NICHE_MAX_MEDIAN_DURATION_SECONDS) return true;
  const titles = videos.slice(0, TITLES_CHECKED).map((video) => video.title);
  return latinShare(titles) < NICHE_MIN_LATIN_SHARE;
}

const byViews = (a: VideoReportRow, b: VideoReportRow): number => b.views - a.views;

/** The outperforming videos as the screen shows them, most viewed first. */
function outperformers(source: NicheSource, report: readonly VideoReportRow[]): BoardVideo[] {
  const durations = new Map(source.videos.map((video) => [video.id, video.durationSeconds]));
  return report
    .filter((row) => isOutperformer(row, source.channel.subscribers))
    .sort(byViews)
    .slice(0, OUTPERFORMERS_SHOWN)
    .map((row) => ({
      videoId: row.id,
      title: row.title,
      views: row.views,
      score: row.score,
      publishedRaw: row.publishedRaw,
      ageDays: row.ageDays,
      durationSeconds: durations.get(row.id) ?? null,
    }));
}

/** What one stored channel looks like as a niche, whether or not it is listed. */
function describe(source: NicheSource, now: Date): Omit<NicheChannel, 'qualifies' | 'watched'> {
  const { channel } = source;
  const report = buildVideoReport(source.videos, now);
  const recent = report.filter((row) => row.ageDays <= RECENT_DAYS);
  const recentViews = recent.reduce((sum, row) => sum + row.views, 0);
  const ageDays = channelAgeDays(report);
  const recentIds = new Set(recent.map((row) => row.id));
  return {
    id: channel.id,
    title: channel.title,
    handle: channel.handle,
    subscribers: channel.subscribers,
    recentViews,
    recentUploads: recent.length,
    viewsPerSubscriber: channel.subscribers ? recentViews / channel.subscribers : null,
    earnings: estimateEarnings(
      source.videos.filter((video) => recentIds.has(video.id)),
      channel.subscribers,
    ),
    channelAgeDays: ageDays,
    reasons: reasonsFor(channel.subscribers, ageDays),
    outperformers: outperformers(source, report),
    ...hitRate(report),
    // The most viewed recent uploads, or the most viewed of all when nothing is recent.
    sampleTitles: [...(recent.length > 0 ? recent : report)]
      .sort(byViews)
      .slice(0, SAMPLE_TITLES)
      .map((row) => ({ videoId: row.id, title: row.title, views: row.views })),
  };
}

/**
 * Most views on recent uploads first: the niche with the most proven demand
 * leads. Views per subscriber would not do, since it puts a channel with one
 * subscriber and 300 views above one with 9,000 and three million.
 */
const byDemand = (a: NicheChannel, b: NicheChannel): number =>
  b.recentViews - a.recentViews ||
  (b.outperformers[0]?.views ?? 0) - (a.outperformers[0]?.views ?? 0) ||
  a.title.localeCompare(b.title);

/**
 * The channels that are new or small and have a recent video that outperforms,
 * plus every channel the owner is watching: a watched channel stays listed
 * after it stops qualifying.
 */
export function buildNicheList(input: NicheInput, now: Date): NicheList {
  const channels = input.sources.flatMap((source): NicheChannel[] => {
    const { id } = source.channel;
    const watched = input.watchedIds.has(id);
    const entry = describe(source, now);
    const qualifies =
      entry.reasons.length > 0 &&
      entry.outperformers.length > 0 &&
      !input.excludedIds.has(id) &&
      !isJunk(source, now);
    return watched || qualifies ? [{ ...entry, qualifies, watched }] : [];
  });
  return {
    channels: [...channels].sort(byDemand),
    channelsChecked: input.sources.length,
    smallMaxSubscribers: NICHE_SMALL_MAX_SUBSCRIBERS,
    newMaxAgeDays: NICHE_NEW_MAX_AGE_DAYS,
  };
}

export interface NicheDeps {
  readonly channels: ChannelRepo;
  readonly videos: VideoRepo;
  readonly maps: MapRepo;
  readonly watchlist: WatchlistRepo;
}

/** The niche list over everything in the store, as it stands now. */
export function loadNicheList(deps: NicheDeps, now: Date): NicheList {
  return buildNicheList(
    {
      sources: deps.channels
        .listAll()
        .map((channel) => ({ channel, videos: deps.videos.listByChannel(channel.id) })),
      watchedIds: new Set(deps.watchlist.listWatched()),
      excludedIds: new Set(deps.maps.listCenterIds()),
    },
    now,
  );
}

import { LOGO_SHOWN_MIN_WIDTH, pickImage } from '../channel/brand';
import { DEFAULT_MAX_VIDEOS } from '../ingest';
import { SMALL_CHANNEL_MAX_SUBSCRIBERS } from '../limits';
import { PEER_MAX_UPLOADS_PER_WEEK, medianDurationSeconds, uploadsPerWeek } from '../map/peers';
import type { BoardVideo } from '../map/thumbnails';
import { RECENT_DAYS } from '../map/view';
import { buildVideoReport, type VideoReportRow } from '../report';
import { estimateEarnings, type EarningsEstimate } from '../scoring/earnings';
import type {
  BrandRepo,
  ChannelRepo,
  FactsRepo,
  MapRepo,
  StoredChannel,
  StoredVideo,
  VideoRepo,
  WatchlistRepo,
} from '../repos/types';
import { GROWTH_WINDOW_DAYS, viewsGained } from './growth';
import { NICHE_OUTPERFORM_WINDOW_DAYS, hitRate, isOutperformer } from './outperform';
import { NICHE_MIN_LATIN_SHARE, dominantScript, latinShare } from './script';
import type {
  NicheChannel,
  NicheInput,
  NicheLanguage,
  NicheList,
  NicheReason,
  NicheSource,
} from './types';

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
 * breakout feed draws too ("Under 10K"); the number is kept in `limits.ts`.
 */
export const NICHE_SMALL_MAX_SUBSCRIBERS = SMALL_CHANNEL_MAX_SUBSCRIBERS;
/**
 * No channel above this is listed, new or not. 100,000 is where YouTube itself
 * stops calling a channel small (its first creator award); a channel under 90
 * days old that is already past it is an established brand's new outlet. On
 * the owner's store the largest new channel under it has 29,900 subscribers
 * and the next one up has 876,000.
 */
export const NICHE_MAX_SUBSCRIBERS = 100_000;
/**
 * The longer of the two windows a channel's views are counted over. The owner
 * judges a niche by three months of uploads: one month swings with a single
 * video, and three is as far back as "what works now" still means now. It is
 * also how far back a channel's hit rate looks.
 */
export const NICHE_LONG_WINDOW_DAYS = 90;
/** Above this a channel is cutting clips, not making videos; the same line the peer rules draw. */
export const NICHE_MAX_UPLOADS_PER_WEEK = PEER_MAX_UPLOADS_PER_WEEK;
/** A channel whose usual upload runs over an hour is re-posting films or streams. */
export const NICHE_MAX_MEDIAN_DURATION_SECONDS = 60 * 60;

/** Newest titles per channel that the alphabet check reads. */
const TITLES_CHECKED = 30;
const SAMPLE_TITLES = 3;
const OUTPERFORMERS_SHOWN = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type {
  NicheChannel,
  NicheInput,
  NicheLanguage,
  NicheList,
  NicheReason,
  NicheSample,
  NicheSource,
} from './types';

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
 * Whether a channel is a large institution or a clip or film re-poster:
 * neither of which the owner could learn a niche from.
 */
function isJunk(source: NicheSource, now: Date): boolean {
  const { channel, videos } = source;
  if (channel.subscribers !== null && channel.subscribers > NICHE_MAX_SUBSCRIBERS) return true;
  if (uploadsPerWeek(videos, now) > NICHE_MAX_UPLOADS_PER_WEEK) return true;
  const usualLength = medianDurationSeconds(videos);
  return usualLength !== null && usualLength > NICHE_MAX_MEDIAN_DURATION_SECONDS;
}

/**
 * The mark for a channel whose titles are mostly in another alphabet, or null
 * for one in Latin letters. A channel with no stored title is not marked:
 * nothing shows what it is written in.
 */
function otherLanguage(videos: readonly StoredVideo[]): NicheLanguage | null {
  const titles = videos.slice(0, TITLES_CHECKED).map((video) => video.title);
  if (titles.length === 0 || latinShare(titles) >= NICHE_MIN_LATIN_SHARE) return null;
  return { script: dominantScript(titles) };
}

interface WindowFigures {
  readonly views: number;
  readonly uploads: number;
  readonly earnings: EarningsEstimate;
}

/** Views, uploads and what the views are worth, for the videos uploaded in the last `days` days. */
function windowFigures(
  source: NicheSource,
  days: number,
  country: string | null,
  now: Date,
): WindowFigures {
  const cutoff = now.getTime() - days * DAY_MS;
  const uploaded = source.videos.filter((video) => video.published.date.getTime() >= cutoff);
  return {
    views: uploaded.reduce((sum, video) => sum + video.views, 0),
    uploads: uploaded.length,
    earnings: estimateEarnings(uploaded, source.channel.subscribers, { country }),
  };
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

/** What is known about a listed channel only once it is known to be listed. */
type ListedOnly =
  | 'qualifies'
  | 'watched'
  | 'growth'
  | 'createdAt'
  | 'country'
  | 'logoUrl'
  | 'recentViews'
  | 'recentUploads'
  | 'viewsPerSubscriber'
  | 'earnings'
  | 'ninetyDayViews'
  | 'ninetyDayUploads'
  | 'ninetyDayEarnings';

/** What one stored channel looks like as a niche, whether or not it is listed. */
function describe(source: NicheSource, now: Date): Omit<NicheChannel, ListedOnly> {
  const { channel } = source;
  const report = buildVideoReport(source.videos, now);
  const recent = report.filter((row) => row.ageDays <= RECENT_DAYS);
  const ageDays = channelAgeDays(report);
  return {
    id: channel.id,
    title: channel.title,
    handle: channel.handle,
    subscribers: channel.subscribers,
    otherLanguage: otherLanguage(source.videos),
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

/** The views, uploads and earnings of a listed channel, over 30 days and over 90. */
function figures(source: NicheSource, country: string | null, now: Date) {
  const month = windowFigures(source, RECENT_DAYS, country, now);
  const quarter = windowFigures(source, NICHE_LONG_WINDOW_DAYS, country, now);
  const { subscribers } = source.channel;
  return {
    recentViews: month.views,
    recentUploads: month.uploads,
    viewsPerSubscriber: subscribers ? month.views / subscribers : null,
    earnings: month.earnings,
    ninetyDayViews: quarter.views,
    ninetyDayUploads: quarter.uploads,
    ninetyDayEarnings: quarter.earnings,
  };
}

/**
 * Most views on the uploads of the last 90 days first: the niche with the most
 * proven demand leads, and three months is steadier than one. Views per
 * subscriber would not do, since it puts a channel with one subscriber and 300
 * views above one with 9,000 and three million.
 */
const byDemand = (a: NicheChannel, b: NicheChannel): number =>
  b.ninetyDayViews - a.ninetyDayViews ||
  b.recentViews - a.recentViews ||
  (b.outperformers[0]?.views ?? 0) - (a.outperformers[0]?.views ?? 0) ||
  a.title.localeCompare(b.title);

/**
 * The channels that are new or small and have a recent video that outperforms,
 * plus every channel the owner is watching: a watched channel stays listed
 * after it stops qualifying. A channel in another alphabet is held to the same
 * rule and listed with its mark.
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
    if (!watched && !qualifies) return [];
    const growth = input.readingsOf ? viewsGained(input.readingsOf(id), now) : null;
    const facts = input.factsOf?.(id) ?? null;
    const createdAt = facts?.createdAt.toISOString() ?? null;
    const country = facts?.country ?? null;
    const counted = figures(source, country, now);
    const logoUrl = input.logoOf?.(id) ?? null;
    return [{ ...entry, ...counted, qualifies, watched, growth, createdAt, country, logoUrl }];
  });
  return {
    channels: [...channels].sort(byDemand),
    channelsChecked: input.channelsChecked ?? input.sources.length,
    smallMaxSubscribers: NICHE_SMALL_MAX_SUBSCRIBERS,
    newMaxAgeDays: NICHE_NEW_MAX_AGE_DAYS,
  };
}

export interface NicheDeps {
  readonly channels: ChannelRepo;
  readonly videos: VideoRepo;
  readonly maps: MapRepo;
  readonly watchlist: WatchlistRepo;
  /** Where channel facts from the official API are kept. Without it entries carry none. */
  readonly facts?: FactsRepo;
  /** Where channel logos are kept. Without it entries carry none. */
  readonly brands?: BrandRepo;
}

const byId = (a: StoredChannel, b: StoredChannel): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The stored channels that could be on the list, picked out by the store
 * without reading a single video: those the owner watches, and those not too
 * large to list that uploaded inside the window an outperforming video must
 * fall in. Every listed channel meets one of the two, so leaving the rest out
 * changes nothing but the work done. On a store of thousands of channels, most
 * of them large, this is a small fraction.
 */
function nicheCandidates(deps: NicheDeps, watchedIds: readonly string[], now: Date) {
  const uploadedSince = new Date(now.getTime() - NICHE_OUTPERFORM_WINDOW_DAYS * DAY_MS);
  const active = deps.channels.listActiveUpTo(NICHE_MAX_SUBSCRIBERS, uploadedSince);
  const activeIds = new Set(active.map((channel) => channel.id));
  const watchedOnly = watchedIds
    .filter((id) => !activeIds.has(id))
    .flatMap((id) => deps.channels.findById(id) ?? []);
  // In the order the whole store would come in, so ties sort as they always did.
  return [...active, ...watchedOnly].sort(byId);
}

/**
 * The niche list over everything in the store, as it stands now. Only the
 * channels that could be listed have their videos loaded.
 */
export function loadNicheList(deps: NicheDeps, now: Date): NicheList {
  const since = new Date(now.getTime() - GROWTH_WINDOW_DAYS * DAY_MS);
  const watchedIds = deps.watchlist.listWatched();
  return buildNicheList(
    {
      sources: nicheCandidates(deps, watchedIds, now).map((channel) => ({
        channel,
        videos: deps.videos.listByChannel(channel.id),
      })),
      channelsChecked: deps.channels.count(),
      watchedIds: new Set(watchedIds),
      excludedIds: new Set(deps.maps.listCenterIds()),
      readingsOf: (channelId) => deps.videos.listChannelReadings(channelId, since),
      factsOf: (channelId) => deps.facts?.find(channelId) ?? null,
      logoOf: (channelId) =>
        pickImage(deps.brands?.find(channelId)?.avatar ?? [], LOGO_SHOWN_MIN_WIDTH)?.url ?? null,
    },
    now,
  );
}

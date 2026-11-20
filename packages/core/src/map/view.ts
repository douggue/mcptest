import { DEFAULT_MAX_VIDEOS } from '../ingest';
import { buildVideoReport } from '../report';
import type {
  ChannelRepo,
  EdgeRepo,
  MapMember,
  RecEdge,
  StoredChannel,
  StoredVideo,
  VideoRepo,
} from '../repos/types';
import { titleSimilarity } from './relevance';

const RECENT_DAYS = 30;
const BREAKOUT_WINDOW_DAYS = 60;
const RISING_MAX_CHANNEL_AGE_DAYS = 90;
const RISING_VIEWS_PER_SUBSCRIBER = 20;
const RISING_BREAKOUT_SCORE = 10;
const RISING_MIN_BREAKOUTS = 2;
/** Newest titles per channel that the similarity score is based on. */
const TITLES_COMPARED = 30;
const CLOSE_SHARE = 0.5;
const MEDIUM_MIN_INBOUND = 2;

export type Tier = 'close' | 'medium' | 'far';

export interface Breakout {
  readonly videoId: string;
  readonly title: string;
  readonly views: number;
  readonly score: number;
}

export interface ChannelMetrics {
  /** Views on videos uploaded in the last 30 days. Not the same as views in the last 30 days. */
  readonly recentViews: number;
  readonly recentUploads: number;
  /** The strongest outlier among videos from the last 60 days. */
  readonly breakout: Breakout | null;
  /** A channel under 90 days old that is already pulling well above its size. */
  readonly rising: boolean;
}

/** What one channel's stored videos say about how it is doing right now. */
export function channelMetrics(
  videos: readonly StoredVideo[],
  subscribers: number | null,
  now: Date,
): ChannelMetrics {
  const report = buildVideoReport(videos, now);
  const recent = report.filter((row) => row.ageDays <= RECENT_DAYS);
  const recentViews = recent.reduce((sum, row) => sum + row.views, 0);
  const scored = report.filter((row) => row.ageDays <= BREAKOUT_WINDOW_DAYS && row.score !== null);
  const best = scored[0];

  // Hitting the fetch cap means older videos may exist that were never read.
  const sawWholeChannel = videos.length > 0 && videos.length < DEFAULT_MAX_VIDEOS;
  const oldestAgeDays = Math.max(0, ...report.map((row) => row.ageDays));
  const isYoung = sawWholeChannel && oldestAgeDays <= RISING_MAX_CHANNEL_AGE_DAYS;
  const outgrowsSize =
    subscribers !== null && recentViews > subscribers * RISING_VIEWS_PER_SUBSCRIBER;
  const repeatBreakouts =
    scored.filter((row) => (row.score ?? 0) >= RISING_BREAKOUT_SCORE).length >=
    RISING_MIN_BREAKOUTS;

  return {
    recentViews,
    recentUploads: recent.length,
    breakout:
      best && best.score !== null
        ? { videoId: best.id, title: best.title, views: best.views, score: best.score }
        : null,
    rising: isYoung && (outgrowsSize || repeatBreakouts),
  };
}

export interface MapMemberData {
  readonly channel: StoredChannel;
  readonly steps: number;
  readonly videos: readonly StoredVideo[];
}

export interface Recommender {
  readonly channelId: string;
  readonly channelTitle: string;
  readonly share: number;
}

export interface MapRow {
  readonly channel: StoredChannel;
  readonly steps: number;
  readonly tier: Tier;
  /** Title similarity to the centre, 0 to 1. */
  readonly relevance: number;
  readonly recommendedBy: readonly Recommender[];
  readonly metrics: ChannelMetrics;
}

export interface MapViewInput {
  readonly center: MapMemberData;
  readonly members: readonly MapMemberData[];
  readonly edges: readonly RecEdge[];
  readonly now: Date;
}

function tierFor(
  member: MapMemberData,
  centerId: string,
  inbound: readonly RecEdge[],
  edges: readonly RecEdge[],
): Tier {
  if (member.steps === 1) {
    const fromCenter = inbound.find((edge) => edge.fromChannelId === centerId);
    const mutual = edges.some(
      (edge) => edge.fromChannelId === member.channel.id && edge.toChannelId === centerId,
    );
    return (fromCenter?.share ?? 0) >= CLOSE_SHARE || mutual ? 'close' : 'medium';
  }
  return inbound.length >= MEDIUM_MIN_INBOUND ? 'medium' : 'far';
}

/** The channels around the centre, nearest and most similar first. */
export function buildMapView(input: MapViewInput): readonly MapRow[] {
  const { center, members, edges, now } = input;
  const titles = new Map(
    [center, ...members].map((member) => [member.channel.id, member.channel.title]),
  );
  const recentTitles = (member: MapMemberData): readonly string[] =>
    member.videos.slice(0, TITLES_COMPARED).map((video) => video.title);
  const relevance = titleSimilarity(
    recentTitles(center),
    new Map(members.map((member) => [member.channel.id, recentTitles(member)])),
  );

  const rows = members.map((member): MapRow => {
    const inbound = edges.filter(
      (edge) => edge.toChannelId === member.channel.id && titles.has(edge.fromChannelId),
    );
    return {
      channel: member.channel,
      steps: member.steps,
      tier: tierFor(member, center.channel.id, inbound, edges),
      relevance: relevance.get(member.channel.id) ?? 0,
      recommendedBy: inbound
        .map((edge) => ({
          channelId: edge.fromChannelId,
          channelTitle: titles.get(edge.fromChannelId) ?? edge.fromChannelId,
          share: edge.share,
        }))
        .sort((a, b) => b.share - a.share || a.channelTitle.localeCompare(b.channelTitle)),
      metrics: channelMetrics(member.videos, member.channel.subscribers, now),
    };
  });

  return [...rows].sort(
    (a, b) =>
      a.steps - b.steps ||
      b.relevance - a.relevance ||
      b.metrics.recentViews - a.metrics.recentViews,
  );
}

export interface MapViewDeps {
  readonly channels: ChannelRepo;
  readonly videos: VideoRepo;
  readonly edges: EdgeRepo;
}

export interface LoadedMapView {
  readonly center: MapMemberData;
  /** Every channel on the map except the centre, with its stored videos. */
  readonly members: readonly MapMemberData[];
  /** The edges the view was built from. */
  readonly edges: readonly RecEdge[];
  readonly rows: readonly MapRow[];
}

/**
 * Loads a crawled map's channels, videos and edges from the store and builds its view.
 *
 * Only edges out of channels this map expanded (fewer steps than its depth) are
 * used. The store may hold edges for other members from earlier crawls, and
 * counting those would make tiers depend on crawl history.
 */
export function loadMapView(
  deps: MapViewDeps,
  members: readonly MapMember[],
  depth: number,
  now: Date,
): LoadedMapView | null {
  const loaded = members.flatMap((member): MapMemberData[] => {
    const channel = deps.channels.findById(member.channelId);
    return channel
      ? [{ channel, steps: member.steps, videos: deps.videos.listByChannel(channel.id) }]
      : [];
  });
  const center = loaded.find((member) => member.steps === 0);
  if (!center) return null;
  const others = loaded.filter((member) => member.steps > 0);
  const expanded = new Set(
    loaded.filter((member) => member.steps < depth).map((member) => member.channel.id),
  );
  const edges = deps.edges
    .listAmong(loaded.map((member) => member.channel.id))
    .filter((edge) => expanded.has(edge.fromChannelId));
  return {
    center,
    members: others,
    edges,
    rows: buildMapView({ center, members: others, edges, now }),
  };
}

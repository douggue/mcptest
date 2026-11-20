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
import { outsideReason, shapeMismatch, type OutsideReason } from './peers';
import { anchoredTitleSimilarity } from './relevance';

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
  /** The same kind of channel as the centre, rather than something YouTube merely showed nearby. */
  readonly peer: boolean;
  /** Why it is not a peer; null when it is one. */
  readonly outsideReason: OutsideReason | null;
}

export interface MapViewInput {
  readonly center: MapMemberData;
  readonly members: readonly MapMemberData[];
  readonly edges: readonly RecEdge[];
  readonly now: Date;
  /** A member the owner wants to be like; channels are then measured against it, not the centre. */
  readonly modelId?: string | null;
}

/**
 * `hubs` are the channels the map was explored from at the first step: the
 * centre and, when the owner named one, the model channel.
 */
function tierFor(
  member: MapMemberData,
  hubs: ReadonlySet<string>,
  inbound: readonly RecEdge[],
  edges: readonly RecEdge[],
): Tier {
  if (member.steps === 1) {
    const strongest = Math.max(
      0,
      ...inbound.filter((edge) => hubs.has(edge.fromChannelId)).map((edge) => edge.share),
    );
    const mutual = edges.some(
      (edge) => edge.fromChannelId === member.channel.id && hubs.has(edge.toChannelId),
    );
    return strongest >= CLOSE_SHARE || mutual ? 'close' : 'medium';
  }
  return inbound.length >= MEDIUM_MIN_INBOUND ? 'medium' : 'far';
}

/** Rounds a score so that channels with effectively equal matches keep a stable order. */
const matchRank = (relevance: number): number => Math.round(relevance * 1000);

/** The channels around the centre: peers first, then by title match, then by distance. */
export function buildMapView(input: MapViewInput): readonly MapRow[] {
  const { center, members, edges, now } = input;
  const model = members.find((member) => member.channel.id === input.modelId) ?? null;
  const reference = model ?? center;
  const hubs = new Set([center.channel.id, ...(model ? [model.channel.id] : [])]);
  const titles = new Map(
    [center, ...members].map((member) => [member.channel.id, member.channel.title]),
  );
  const subject = (member: MapMemberData) => ({
    subscribers: member.channel.subscribers,
    videos: member.videos,
  });
  const shapes = new Map(
    members.map((member) => [
      member.channel.id,
      shapeMismatch(subject(reference), subject(member), now),
    ]),
  );
  const fits = members.filter((member) => shapes.get(member.channel.id) === null);
  const direct = fits.filter((member) => member.steps === 1);
  const recentTitles = (member: MapMemberData): readonly string[] =>
    member.videos.slice(0, TITLES_COMPARED).map((video) => video.title);
  const { scores } = anchoredTitleSimilarity(
    recentTitles(reference),
    new Map(members.map((member) => [member.channel.id, recentTitles(member)])),
    (direct.length > 0 ? direct : fits).map((member) => member.channel.id),
  );

  const rows = members.map((member): MapRow => {
    const inbound = edges.filter(
      (edge) => edge.toChannelId === member.channel.id && titles.has(edge.fromChannelId),
    );
    const relevance = scores.get(member.channel.id) ?? 0;
    // The model is by definition what the owner wants to be like.
    const reason =
      member === model ? null : outsideReason(shapes.get(member.channel.id) ?? null, relevance);
    return {
      channel: member.channel,
      steps: member.steps,
      tier: member === model ? 'close' : tierFor(member, hubs, inbound, edges),
      relevance,
      recommendedBy: inbound
        .map((edge) => ({
          channelId: edge.fromChannelId,
          channelTitle: titles.get(edge.fromChannelId) ?? edge.fromChannelId,
          share: edge.share,
        }))
        .sort((a, b) => b.share - a.share || a.channelTitle.localeCompare(b.channelTitle)),
      metrics: channelMetrics(member.videos, member.channel.subscribers, now),
      peer: reason === null,
      outsideReason: reason,
    };
  });

  return [...rows].sort(
    (a, b) =>
      Number(b.peer) - Number(a.peer) ||
      matchRank(b.relevance) - matchRank(a.relevance) ||
      a.steps - b.steps ||
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
  modelChannelId: string | null = null,
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
    loaded
      // The model is explored at the first step whatever the depth.
      .filter((member) => member.steps < depth || member.channel.id === modelChannelId)
      .map((member) => member.channel.id),
  );
  const edges = deps.edges
    .listAmong(loaded.map((member) => member.channel.id))
    .filter((edge) => expanded.has(edge.fromChannelId));
  return {
    center,
    members: others,
    edges,
    rows: buildMapView({ center, members: others, edges, now, modelId: modelChannelId }),
  };
}

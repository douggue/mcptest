import type {
  CompetitorStatus,
  CrawlProgress,
  MapSnapshot,
  NicheChannel,
  NicheList,
  SnapshotBreakout,
  SnapshotChannel,
  ThumbnailBoard,
  TransferFormat,
  TransferIdea,
  TransferList,
  TransferVersion,
} from '@jgtube/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  ChannelVideos,
  ConnectorEngine,
  CrawlChoices,
  CrawlOutcome,
  TransferChoices,
} from '../src/types';

export const CENTER_ID = 'UCcccccccccccccccccccccc';
export const ALPHA_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa';
export const BETA_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb';
export const GIANT_ID = 'UCgggggggggggggggggggggg';
export const DROPPED_ID = 'UCdddddddddddddddddddddd';

export function channel(overrides: Partial<SnapshotChannel> = {}): SnapshotChannel {
  return {
    id: ALPHA_ID,
    title: 'Alpha',
    handle: 'alpha',
    subscribers: 5000,
    steps: 1,
    tier: 'close',
    relevance: 0.6234,
    centerShare: 0.5,
    recentViews: 120_000,
    recentUploads: 4,
    rising: false,
    breakout: null,
    recommendedBy: [],
    peer: true,
    outsideReason: null,
    removed: false,
    kept: false,
    ...overrides,
  };
}

export function breakout(overrides: Partial<SnapshotBreakout> = {}): SnapshotBreakout {
  return {
    videoId: 'aaaaaaaaaa1',
    title: 'America Just Built The Impossible',
    views: 90_000,
    ageDays: 6.4321,
    publishedRaw: '6d ago',
    durationSeconds: 912,
    score: 8.2649,
    channelId: ALPHA_ID,
    channelTitle: 'Alpha',
    channelSubscribers: 5000,
    baseline: 10_889.4,
    sampleSize: 14,
    channelHits: 3,
    channelScored: 15,
    channelAgeDays: 71.9,
    caution: null,
    peer: true,
    ...overrides,
  };
}

export function snapshot(overrides: Partial<MapSnapshot> = {}): MapSnapshot {
  return {
    mapId: 7,
    depth: 2,
    region: 'US',
    createdAt: '2026-11-20T05:10:00.000Z',
    center: {
      id: CENTER_ID,
      title: 'My Channel',
      handle: 'mychannel',
      subscribers: 1200,
      storedVideos: 12,
    },
    model: null,
    channels: [
      channel({
        rising: true,
        breakout: {
          videoId: 'aaaaaaaaaa1',
          title: 'America Just Built The Impossible',
          views: 90_000,
          score: 8.2649,
        },
      }),
      channel({
        id: BETA_ID,
        title: 'Beta',
        handle: null,
        subscribers: null,
        tier: 'medium',
        relevance: 0.4149,
      }),
      channel({ id: DROPPED_ID, title: 'Dropped', removed: true }),
      channel({
        id: GIANT_ID,
        title: 'Giant',
        subscribers: 9_000_000,
        tier: 'far',
        relevance: 0.1,
        peer: false,
        outsideReason: 'larger',
      }),
    ],
    edges: [],
    breakouts: [
      breakout(),
      breakout({
        videoId: 'bbbbbbbbbb1',
        title: 'Why This Bridge Changed Everything',
        views: 4000,
        score: 3.04,
        channelId: BETA_ID,
        channelTitle: 'Beta',
        channelSubscribers: null,
        baseline: 1315.2,
        sampleSize: 3,
        channelHits: 1,
        channelScored: 4,
        channelAgeDays: null,
        durationSeconds: null,
        caution: 'few-videos',
      }),
      breakout({
        videoId: 'ggggggggggg',
        title: 'The Biggest Machine On Earth',
        views: 30_000_000,
        score: 12.5,
        channelId: GIANT_ID,
        channelTitle: 'Giant',
        channelSubscribers: 9_000_000,
        peer: false,
      }),
    ],
    ...overrides,
  };
}

export function board(overrides: Partial<ThumbnailBoard> = {}): ThumbnailBoard {
  const video = (videoId: string, views: number, score: number) => ({
    videoId,
    title: `Title of ${videoId}`,
    views,
    score,
    publishedRaw: '2w ago',
    ageDays: 14,
    durationSeconds: 900,
  });
  return {
    mapId: 7,
    center: {
      id: CENTER_ID,
      title: 'My Channel',
      subscribers: 1200,
      videos: [
        { ...video('ccccccccc01', 800, 1.1234) },
        { ...video('ccccccccc02', 300, 0), score: null },
      ],
    },
    channels: [
      {
        id: ALPHA_ID,
        title: 'Alpha',
        subscribers: 5000,
        winners: [
          video('aaaaaaaaaa1', 90_000, 8.2649),
          video('aaaaaaaaaa2', 50_000, 4.5),
          video('aaaaaaaaaa3', 30_000, 2.7),
        ],
        ordinary: [video('aaaaaaaaaa8', 9000, 0.8), video('aaaaaaaaaa9', 7000, 0.6)],
        winnerCount: 5,
        scoredCount: 20,
      },
      {
        id: BETA_ID,
        title: 'Beta',
        subscribers: null,
        winners: [],
        ordinary: [video('bbbbbbbbbb8', 1000, 1)],
        winnerCount: 0,
        scoredCount: 4,
      },
      {
        id: GIANT_ID,
        title: 'Gamma',
        subscribers: 800,
        winners: [video('ggggggggg01', 20_000, 3.3)],
        ordinary: [],
        winnerCount: 1,
        scoredCount: 9,
      },
    ],
    winnerMinScore: 2,
    ordinaryMaxScore: 1.2,
    ...overrides,
  };
}

export function channelVideos(count = 3): ChannelVideos {
  return {
    channel: { id: ALPHA_ID, title: 'Alpha', handle: 'alpha', subscribers: 5000 },
    videos: Array.from({ length: count }, (_, index) => ({
      id: `aaaaaaaaa${String(index).padStart(2, '0')}`,
      title: `Video ${index}`,
      views: 10_000 - index * 1000,
      ageDays: index * 7 + 0.4567,
      publishedRaw: `${index}w ago`,
      score: index === count - 1 ? null : 5.5555 - index,
      baseline: index === count - 1 ? null : 1800.6,
      sampleSize: index === count - 1 ? null : 12,
      durationSeconds: index === 0 ? null : 600,
    })),
  };
}

export function niche(overrides: Partial<NicheChannel> = {}): NicheChannel {
  return {
    id: ALPHA_ID,
    title: 'Alpha',
    handle: 'alpha',
    subscribers: 5000,
    recentViews: 420_000,
    recentUploads: 6,
    viewsPerSubscriber: 84.04,
    earnings: {
      low: 840,
      high: 3360,
      longFormViews: 420_000,
      shortsViews: 0,
      belowAdThreshold: false,
      rateTier: { id: 'unknown', multiplier: 1, country: null },
    },
    ninetyDayViews: 990_000,
    ninetyDayUploads: 14,
    ninetyDayEarnings: {
      low: 1980,
      high: 7920,
      longFormViews: 990_000,
      shortsViews: 0,
      belowAdThreshold: false,
      rateTier: { id: 'unknown', multiplier: 1, country: null },
    },
    otherLanguage: null,
    channelAgeDays: 41.7,
    reasons: ['new', 'small'],
    outperformers: [
      {
        videoId: 'aaaaaaaaaa1',
        title: 'America Just Built The Impossible',
        views: 90_000,
        score: 8.2649,
        publishedRaw: '6d ago',
        ageDays: 6,
        durationSeconds: 900,
      },
    ],
    hitCount: 2,
    scoredCount: 9,
    sampleTitles: [
      { videoId: 'aaaaaaaaaa1', title: 'America Just Built The Impossible', views: 90_000 },
      { videoId: 'aaaaaaaaaa2', title: 'The Tunnel Nobody Wanted', views: 60_000 },
    ],
    qualifies: true,
    watched: false,
    growth: null,
    createdAt: null,
    country: null,
    ...overrides,
  };
}

export function nicheList(channels: readonly NicheChannel[] = [niche()]): NicheList {
  return { channels, channelsChecked: 320, smallMaxSubscribers: 10_000, newMaxAgeDays: 90 };
}

export function version(overrides: Partial<TransferVersion> = {}): TransferVersion {
  return {
    videoId: 'sssssssssss',
    title: 'South Africa Just Found A Fuel That Shouldn’t Exist',
    channelId: ALPHA_ID,
    channelTitle: 'Alpha',
    subscribers: 7440,
    place: { key: 'ZA', name: 'South Africa', source: 'title' },
    views: 521_000,
    score: 22.8431,
    ageDays: 21.4,
    durationSeconds: 840,
    strong: true,
    ...overrides,
  };
}

export function idea(overrides: Partial<TransferIdea> = {}): TransferIdea {
  const winner = version();
  const other = version({
    videoId: 'uuuuuuuuuuu',
    title: 'UK Just Found A Fuel That Shouldn’t Exist',
    channelId: BETA_ID,
    channelTitle: 'Beta',
    subscribers: null,
    place: { key: 'GB', name: 'UK', source: 'title' },
    views: 596,
    score: null,
    strong: false,
  });
  return {
    key: '{place} just found fuel shouldn exist',
    template: "{place} just found a fuel that shouldn't exist",
    verdict: { status: 'open', winner, own: null },
    opportunity: true,
    versions: [winner, other],
    versionCount: 2,
    channelCount: 2,
    best: winner,
    worst: other,
    places: [
      { key: 'ZA', name: 'South Africa', versions: 1, bestViews: 521_000 },
      { key: 'GB', name: 'UK', versions: 1, bestViews: 596 },
    ],
    variants: [
      {
        videoId: 'vvvvvvvvvvv',
        title: 'America Just Detected A Fuel That Shouldn’t Exist',
        channelTitle: 'Valtrum',
        views: 2600,
        word: 'detected',
      },
    ],
    saved: false,
    ...overrides,
  };
}

export function format(overrides: Partial<TransferFormat> = {}): TransferFormat {
  return {
    key: '{place} new invention could make {subject} obsolete forever',
    template: '{place} new invention could make {subject} obsolete forever',
    subjectCount: 4,
    channelCount: 3,
    videoCount: 5,
    bestViews: 129_000,
    medianViews: 34_700.5,
    places: [{ key: 'US', name: 'America', versions: 5, bestViews: 129_000 }],
    subjects: [
      {
        subject: 'carbon fiber',
        videos: 2,
        channels: 2,
        bestViews: 129_000,
        videoId: 'ccccccccccc',
        title: 'America’s New Invention Could Make Carbon Fiber Obsolete Forever',
        channelTitle: 'Modern Frontier',
      },
    ],
    ...overrides,
  };
}

export function transferList(overrides: Partial<TransferList> = {}): TransferList {
  return {
    ownerPlace: { key: 'US', name: 'America', source: 'titles' },
    windowDays: 90,
    videosChecked: 15_092,
    ideas: [idea()],
    ideaCount: 1,
    opportunityCount: 1,
    formats: [format()],
    formatCount: 1,
    ...overrides,
  };
}

type Crawl = ConnectorEngine['crawl'];

/** Stands in for the store and YouTube; every answer can be replaced by a test. */
export class FakeEngine implements ConnectorEngine {
  stored: MapSnapshot | null = snapshot();
  storedBoard: ThumbnailBoard | null = board();
  storedVideos: ChannelVideos | null = channelVideos();
  lookups: string[] = [];
  crawls: Array<{ channel: string; depth: number; choices: CrawlChoices | undefined }> = [];
  progress: readonly CrawlProgress[] = [
    { stage: 'reading-recommendations', channels: 1, step: 1 },
    { stage: 'reading-channels', channels: 9 },
    { stage: 'done', channels: 9 },
  ];
  outcome: () => Promise<CrawlOutcome> = () =>
    Promise.resolve({ centerChannelId: CENTER_ID, warnings: [] });

  findSnapshot(ref: string): MapSnapshot | null {
    this.lookups.push(ref);
    return this.stored;
  }

  findThumbnailBoard(ref: string): ThumbnailBoard | null {
    this.lookups.push(ref);
    return this.storedBoard;
  }

  findChannelVideos(ref: string): ChannelVideos | null {
    this.lookups.push(ref);
    return this.storedVideos;
  }

  crawl: Crawl = (ref, depth, onProgress, choices) => {
    this.crawls.push({ channel: ref, depth, choices });
    this.progress.forEach(onProgress);
    return this.outcome();
  };

  statusCalls: Array<[string, string, CompetitorStatus]> = [];

  /** Applies the choice to the stored map the way the real engine's next read would show it. */
  setCompetitorStatus(centerId: string, channelId: string, status: CompetitorStatus): boolean {
    this.statusCalls.push([centerId, channelId, status]);
    const map = this.stored;
    if (!map || !map.channels.some((entry) => entry.id === channelId)) return false;
    this.stored = {
      ...map,
      channels: map.channels.map((entry) =>
        entry.id === channelId
          ? {
              ...entry,
              kept: status === 'kept',
              removed: status === 'removed',
              peer: status === 'kept' || entry.outsideReason === null,
            }
          : entry,
      ),
    };
    return true;
  }

  transfers: TransferList = transferList();
  transferReads: TransferChoices[] = [];

  listTransfers(choices: TransferChoices = {}): TransferList {
    this.transferReads.push(choices);
    return this.transfers;
  }

  niches: NicheList = nicheList();

  listNiches(): NicheList {
    return this.niches;
  }
}

/** The text parts of a tool result, joined. */
export function textOf(result: CallToolResult): string {
  return result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
}

/** A tool result's single JSON text part, parsed. */
export function jsonOf(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>;
}

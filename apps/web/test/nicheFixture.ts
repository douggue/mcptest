import type { BoardVideo, NicheChannel } from '@jgtube/core';

export const cid = (n: number) => `UC${String(n).padStart(22, '0')}`;
const vid = (n: number) => `video${String(n).padStart(6, '0')}`;

const UNKNOWN_TIER = { id: 'unknown', multiplier: 1, country: null } as const;

/** A video that took off, scored `score` times its channel's usual views. */
export const tookOff = (n: number, score: number | null): BoardVideo => ({
  videoId: vid(n),
  title: `Video ${n}`,
  views: 50_000,
  score,
  publishedRaw: '1w ago',
  ageDays: 7,
  durationSeconds: 600,
});

/** An estimate of `low` to `high` dollars for the last 30 days of uploads, from these views. */
export const worth = (
  low: number,
  high: number,
  longFormViews = 100_000,
  shortsViews = 0,
): NicheChannel['earnings'] => ({
  low,
  high,
  longFormViews,
  shortsViews,
  belowAdThreshold: false,
  rateTier: UNKNOWN_TIER,
});

/** A listed channel with plain numbers; `n` keeps ids and titles apart. */
export const niche = (n: number, overrides: Partial<NicheChannel> = {}): NicheChannel => ({
  id: cid(n),
  title: `Channel ${n}`,
  handle: `handle${n}`,
  subscribers: 5000,
  recentViews: 100_000,
  recentUploads: 4,
  viewsPerSubscriber: 20,
  earnings: worth(200, 800),
  ninetyDayViews: 250_000,
  ninetyDayUploads: 12,
  ninetyDayEarnings: worth(500, 2000),
  otherLanguage: null,
  channelAgeDays: 30,
  reasons: ['new', 'small'],
  outperformers: [],
  hitCount: 2,
  scoredCount: 9,
  sampleTitles: [],
  qualifies: true,
  watched: false,
  growth: null,
  createdAt: null,
  country: null,
  logoUrl: null,
  ...overrides,
});

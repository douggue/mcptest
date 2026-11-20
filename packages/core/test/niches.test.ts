import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../src/db/sqlite';
import {
  NICHE_MAX_MEDIAN_DURATION_SECONDS,
  NICHE_MAX_SUBSCRIBERS,
  NICHE_MAX_UPLOADS_PER_WEEK,
  NICHE_NEW_MAX_AGE_DAYS,
  NICHE_SMALL_MAX_SUBSCRIBERS,
  buildNicheList,
  loadNicheList,
  type NicheSource,
} from '../src/niches/niches';
import {
  NICHE_MIN_OUTLIER_SCORE,
  NICHE_MIN_VIDEO_VIEWS,
  NICHE_MIN_VIEWS_PER_SUBSCRIBER,
  NICHE_OUTPERFORM_WINDOW_DAYS,
  isOutperformer,
} from '../src/niches/outperform';
import { NICHE_MIN_LATIN_SHARE, latinShare } from '../src/niches/script';
import type { VideoReportRow } from '../src/report';
import { SqliteChannelRepo } from '../src/repos/sqliteChannelRepo';
import { SqliteMapRepo } from '../src/repos/sqliteMapRepo';
import { SqliteVideoRepo } from '../src/repos/sqliteVideoRepo';
import { SqliteWatchlistRepo } from '../src/repos/sqliteWatchlistRepo';
import type { StoredChannel, StoredVideo } from '../src/repos/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (letter: string) => `UC${letter.repeat(22)}`;
const vid = (letter: string, n: number) => letter.repeat(9) + String(n).padStart(2, '0');

interface VideoSpec {
  readonly views: number;
  readonly daysAgo: number;
  readonly title?: string;
  readonly durationSeconds?: number;
}

const videos = (letter: string, specs: readonly VideoSpec[]): StoredVideo[] =>
  specs.map((spec, index) => ({
    id: vid(letter, index),
    channelId: cid(letter),
    title: spec.title ?? `How ${letter} Built Thing ${index}`,
    views: spec.views,
    durationSeconds: spec.durationSeconds ?? 900,
    published: {
      date: new Date(NOW.getTime() - spec.daysAgo * DAY_MS),
      precision: 'day',
      raw: `${spec.daysAgo}d ago`,
    },
    fetchedAt: NOW,
  }));

/** A channel 40 days old whose newest video drew about fifty times its usual thousand views. */
const NEW_WITH_HIT: readonly VideoSpec[] = [
  { views: 40_000, daysAgo: 5 },
  { views: 1000, daysAgo: 12 },
  { views: 1200, daysAgo: 20 },
  { views: 900, daysAgo: 35 },
  { views: 1100, daysAgo: 40 },
];
/** The same recent videos on a channel that has been publishing for most of a year. */
const OLD_WITH_HIT: readonly VideoSpec[] = [
  ...NEW_WITH_HIT,
  { views: 1000, daysAgo: 200 },
  { views: 1000, daysAgo: 300 },
];
/** A new channel where every video does about the same. */
const NEW_AND_FLAT = NEW_WITH_HIT.map((spec) => ({ ...spec, views: 1000 }));

const source = (
  letter: string,
  subscribers: number | null,
  specs: readonly VideoSpec[] = NEW_WITH_HIT,
): NicheSource => ({
  channel: {
    id: cid(letter),
    title: `Channel ${letter}`,
    handle: `handle${letter}`,
    subscribers,
    subscribersHidden: subscribers === null,
    videoCount: specs.length,
    fetchedAt: NOW,
  } satisfies StoredChannel,
  videos: videos(letter, specs),
});

const NONE: ReadonlySet<string> = new Set();
const list = (
  sources: readonly NicheSource[],
  watchedIds: ReadonlySet<string> = NONE,
  excludedIds: ReadonlySet<string> = NONE,
) => buildNicheList({ sources, watchedIds, excludedIds }, NOW);
const titlesOf = (sources: readonly NicheSource[]) =>
  list(sources).channels.map((entry) => entry.title);
const reasonsOf = (item: NicheSource) => list([item]).channels.map((entry) => entry.reasons);

describe('latinShare', () => {
  test('is 1 for titles written in Latin letters, whatever else they hold', () => {
    expect(latinShare(['How 3 Engineers Built a $2,000,000 Bridge!', 'Why? 🚀'])).toBe(1);
  });

  test('is near 0 for titles in another script', () => {
    expect(latinShare(['Почему уголь — самое странное топливо Земли?'])).toBe(0);
    expect(latinShare(['Subaru сделала то, что не решился никто'])).toBeLessThan(
      NICHE_MIN_LATIN_SHARE,
    );
  });

  test('lets through an English title that quotes a foreign name', () => {
    expect(
      latinShare(['The Rise and Fall of Leclanché Cells', 'Inside Москва Metro']),
    ).toBeGreaterThan(NICHE_MIN_LATIN_SHARE);
  });

  test('is 0 when there is no letter to judge by', () => {
    expect(latinShare([])).toBe(0);
    expect(latinShare(['2026 !!! 🚀'])).toBe(0);
  });
});

describe('isOutperformer', () => {
  const BIG_CHANNEL = 1_000_000;
  const row = (overrides: Partial<VideoReportRow> = {}): VideoReportRow => ({
    id: 'aaaaaaaaaaa',
    title: 'A video',
    views: 50_000,
    ageDays: 5,
    publishedRaw: '5d ago',
    score: NICHE_MIN_OUTLIER_SCORE,
    baseline: 6000,
    sampleSize: 10,
    ...overrides,
  });

  test('takes a recent video far above its channel’s usual views', () => {
    expect(isOutperformer(row(), BIG_CHANNEL)).toBe(true);
    expect(isOutperformer(row({ score: NICHE_MIN_OUTLIER_SCORE - 0.1 }), BIG_CHANNEL)).toBe(false);
  });

  test('takes a recent video seen by many times the channel’s subscribers, scored or not', () => {
    const views = NICHE_MIN_VIDEO_VIEWS * 2;
    const subscribers = views / NICHE_MIN_VIEWS_PER_SUBSCRIBER;

    expect(isOutperformer(row({ views, score: null }), subscribers)).toBe(true);
    expect(isOutperformer(row({ views, score: 1 }), subscribers)).toBe(true);
    expect(isOutperformer(row({ views, score: null }), subscribers + 1)).toBe(false);
  });

  test('refuses a large multiple that is still very few people', () => {
    const views = NICHE_MIN_VIDEO_VIEWS - 1;

    expect(isOutperformer(row({ views, score: 800, baseline: 12 }), 10)).toBe(false);
    expect(isOutperformer(row({ views: views + 1, score: 800, baseline: 12 }), 10)).toBe(true);
  });

  test('refuses a video that is no longer recent', () => {
    expect(isOutperformer(row({ ageDays: NICHE_OUTPERFORM_WINDOW_DAYS }), BIG_CHANNEL)).toBe(true);
    expect(isOutperformer(row({ ageDays: NICHE_OUTPERFORM_WINDOW_DAYS + 1 }), BIG_CHANNEL)).toBe(
      false,
    );
  });

  test('judges a channel with no known subscriber count by the score alone', () => {
    expect(isOutperformer(row(), null)).toBe(true);
    expect(isOutperformer(row({ score: null }), null)).toBe(false);
    expect(isOutperformer(row({ score: null }), 0)).toBe(false);
  });
});

describe('buildNicheList', () => {
  test('describes a new, small channel with what is needed to judge it', () => {
    const [entry] = list([source('A', 2000)]).channels;

    expect(entry).toEqual({
      id: cid('A'),
      title: 'Channel A',
      handle: 'handleA',
      subscribers: 2000,
      recentViews: 40_000 + 1000 + 1200,
      recentUploads: 3,
      viewsPerSubscriber: 21.1,
      earnings: {
        low: 84,
        high: 338,
        longFormViews: 42_200,
        shortsViews: 0,
        belowAdThreshold: false,
      },
      channelAgeDays: 40,
      reasons: ['new', 'small'],
      outperformers: [
        {
          videoId: vid('A', 0),
          title: 'How A Built Thing 0',
          views: 40_000,
          score: expect.any(Number),
          publishedRaw: '5d ago',
          ageDays: 5,
          durationSeconds: 900,
        },
      ],
      hitCount: 1,
      scoredCount: 5,
      sampleTitles: [
        { videoId: vid('A', 0), title: 'How A Built Thing 0', views: 40_000 },
        { videoId: vid('A', 2), title: 'How A Built Thing 2', views: 1200 },
        { videoId: vid('A', 1), title: 'How A Built Thing 1', views: 1000 },
      ],
      qualifies: true,
      watched: false,
    });
    expect(entry?.outperformers[0]?.score).toBeGreaterThan(40);
  });

  test('says how many channels it went through and where new and small stop', () => {
    const found = list([source('A', 2000), source('B', 2000, NEW_AND_FLAT)]);

    expect(found).toMatchObject({
      channelsChecked: 2,
      smallMaxSubscribers: NICHE_SMALL_MAX_SUBSCRIBERS,
      newMaxAgeDays: NICHE_NEW_MAX_AGE_DAYS,
    });
    expect(found.channels).toHaveLength(1);
  });

  test('lists a small channel whatever its age', () => {
    expect(reasonsOf(source('A', NICHE_SMALL_MAX_SUBSCRIBERS, OLD_WITH_HIT))).toEqual([['small']]);
  });

  test('lists a new channel that is not small, or that hides its size', () => {
    expect(reasonsOf(source('A', NICHE_SMALL_MAX_SUBSCRIBERS + 1))).toEqual([['new']]);
    expect(list([source('A', null)]).channels).toEqual([
      expect.objectContaining({ reasons: ['new'], subscribers: null, viewsPerSubscriber: null }),
    ]);
  });

  test('leaves out a channel that is neither new nor known to be small', () => {
    expect(
      titlesOf([
        source('A', NICHE_SMALL_MAX_SUBSCRIBERS + 1, OLD_WITH_HIT),
        source('B', null, OLD_WITH_HIT),
      ]),
    ).toEqual([]);
  });

  test('does not call a channel new when its first upload is over the limit', () => {
    const born = (daysAgo: number) => [...NEW_WITH_HIT, { views: 1000, daysAgo }];

    expect(reasonsOf(source('A', 50_000, born(NICHE_NEW_MAX_AGE_DAYS)))).toEqual([['new']]);
    expect(reasonsOf(source('A', 50_000, born(NICHE_NEW_MAX_AGE_DAYS + 1)))).toEqual([]);
  });

  test('does not call a channel new when older videos may never have been read', () => {
    const capped = [
      ...NEW_WITH_HIT,
      ...Array.from({ length: 95 }, (_, index) => ({ views: 1000, daysAgo: 41 + (index % 40) })),
    ];

    expect(reasonsOf(source('A', 50_000, capped))).toEqual([]);
    expect(list([source('A', 2000, capped)]).channels).toEqual([
      expect.objectContaining({ reasons: ['small'], channelAgeDays: null }),
    ]);
  });

  test('leaves out a new channel that is already large', () => {
    expect(
      titlesOf([source('A', NICHE_MAX_SUBSCRIBERS), source('B', NICHE_MAX_SUBSCRIBERS + 1)]),
    ).toEqual(['Channel A']);
  });

  test('leaves out a channel with no recent video that outperforms', () => {
    expect(titlesOf([source('A', 2000, NEW_AND_FLAT)])).toEqual([]);
  });

  test('carries up to three outperforming videos, most viewed first, and the hit rate', () => {
    const hits = [
      { views: 30_000, daysAgo: 3 },
      { views: 90_000, daysAgo: 6 },
      { views: 20_000, daysAgo: 9 },
      { views: 60_000, daysAgo: 12 },
      ...[20, 25, 35, 40, 45, 50].map((daysAgo) => ({ views: 1000, daysAgo })),
    ];
    const [entry] = list([source('A', 2000, hits)]).channels;

    expect(entry?.outperformers.map((video) => video.views)).toEqual([90_000, 60_000, 30_000]);
    expect(entry).toMatchObject({ hitCount: 4, scoredCount: 10 });
  });

  test('leaves out a clip channel that publishes many times a day', () => {
    const perWeek = NICHE_MAX_UPLOADS_PER_WEEK + 1;
    const flood = Array.from({ length: perWeek * 2 }, (_, index) => ({
      views: index === 0 ? 40_000 : 1000,
      daysAgo: 1 + (index % 13),
    }));

    expect(titlesOf([source('A', 2000, flood)])).toEqual([]);
  });

  test('leaves out a channel whose usual upload is a full-length film', () => {
    const lasting = (durationSeconds: number) =>
      NEW_WITH_HIT.map((spec) => ({ ...spec, durationSeconds }));

    expect(
      titlesOf([
        source('A', 2000, lasting(NICHE_MAX_MEDIAN_DURATION_SECONDS + 1)),
        source('B', 2000, lasting(NICHE_MAX_MEDIAN_DURATION_SECONDS)),
      ]),
    ).toEqual(['Channel B']);
  });

  test('leaves out a channel whose titles are in another script', () => {
    const russian = NEW_WITH_HIT.map((spec) => ({ ...spec, title: 'Почему исчезли паровозы' }));

    expect(titlesOf([source('A', 2000, russian)])).toEqual([]);
  });

  test('leaves out the channels the owner maps from', () => {
    expect(
      list([source('A', 2000), source('B', 2000)], NONE, new Set([cid('A')])).channels,
    ).toEqual([expect.objectContaining({ id: cid('B') })]);
  });

  test('puts the channel with the most views on its recent uploads first', () => {
    const scaled = (factor: number) =>
      NEW_WITH_HIT.map((spec) => ({ ...spec, views: spec.views * factor }));

    expect(
      titlesOf([source('A', 2000, scaled(0.5)), source('B', 2000), source('C', 2000, scaled(10))]),
    ).toEqual(['Channel C', 'Channel B', 'Channel A']);
  });

  test('marks the channels the owner is watching', () => {
    const found = list([source('A', 2000), source('B', 2000)], new Set([cid('B')]));

    expect(found.channels.map((entry) => [entry.title, entry.watched])).toEqual([
      ['Channel A', false],
      ['Channel B', true],
    ]);
  });

  test('keeps a watched channel on the list after it stops qualifying, and says so', () => {
    const quiet = [
      { views: 700, daysAgo: 3, title: 'A newer one' },
      ...OLD_WITH_HIT.map((spec) => ({ ...spec, daysAgo: spec.daysAgo + 100 })),
    ];
    const sources = [source('A', NICHE_MAX_SUBSCRIBERS * 5, quiet)];

    expect(list(sources).channels).toEqual([]);
    expect(list(sources, new Set([cid('A')])).channels).toEqual([
      expect.objectContaining({
        id: cid('A'),
        qualifies: false,
        watched: true,
        reasons: [],
        outperformers: [],
        recentViews: 700,
        sampleTitles: [{ videoId: vid('A', 0), title: 'A newer one', views: 700 }],
      }),
    ]);
  });

  test('falls back to the most viewed stored videos when nothing is recent', () => {
    const quiet = NEW_WITH_HIT.map((spec) => ({ ...spec, daysAgo: spec.daysAgo + 200 }));
    const [entry] = list([source('A', 2000, quiet)], new Set([cid('A')])).channels;

    expect(entry?.sampleTitles.map((sample) => sample.views)).toEqual([40_000, 1200, 1100]);
    expect(entry).toMatchObject({
      recentViews: 0,
      recentUploads: 0,
      channelAgeDays: 240,
      qualifies: false,
      reasons: ['small'],
    });
  });
});

describe('loadNicheList', () => {
  let deps: Parameters<typeof loadNicheList>[0];

  const store = (item: NicheSource): void => {
    deps.channels.upsert(item.channel, NOW);
    deps.videos.upsertMany(item.videos, NOW);
  };

  beforeEach(() => {
    const db = openDatabase(':memory:');
    deps = {
      channels: new SqliteChannelRepo(db),
      videos: new SqliteVideoRepo(db),
      maps: new SqliteMapRepo(db),
      watchlist: new SqliteWatchlistRepo(db),
    };
  });

  test('is empty for an empty store', () => {
    expect(loadNicheList(deps, NOW)).toMatchObject({ channels: [], channelsChecked: 0 });
  });

  test('goes through every stored channel, whichever map it came from', () => {
    for (const letter of ['A', 'B', 'C', 'D']) store(source(letter, 2000));
    deps.maps.create(
      {
        centerChannelId: cid('C'),
        depth: 1,
        region: 'US',
        members: [
          { channelId: cid('C'), steps: 0 },
          { channelId: cid('A'), steps: 1 },
        ],
      },
      NOW,
    );
    deps.watchlist.setWatched(cid('B'), true, NOW);

    const found = loadNicheList(deps, NOW);

    expect(found.channelsChecked).toBe(4);
    expect(found.channels.map((entry) => [entry.id, entry.watched])).toEqual([
      [cid('A'), false],
      [cid('B'), true],
      [cid('D'), false],
    ]);
  });
});

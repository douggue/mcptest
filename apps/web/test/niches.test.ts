import type { NicheChannel, NicheList } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApi } from '../src/lib/api';
import {
  NICHE_FILTERS,
  describeOrigin,
  describeEarnings,
  describeLanguage,
  describeRateTier,
  describeSearch,
  describeHits,
  describeList,
  filterNiches,
  formatPerSubscriber,
  otherTitles,
  withWatched,
} from '../src/lib/niches';

const cid = (n: number) => `UC${String(n).padStart(22, '0')}`;
const vid = (n: number) => `video${String(n).padStart(6, '0')}`;

const UNKNOWN_TIER = { id: 'unknown', multiplier: 1, country: null } as const;

const niche = (n: number, overrides: Partial<NicheChannel> = {}): NicheChannel => ({
  id: cid(n),
  title: `Channel ${n}`,
  handle: `handle${n}`,
  subscribers: 1000 * n,
  recentViews: 100_000 * n,
  recentUploads: 10,
  viewsPerSubscriber: 100,
  earnings: {
    low: 200 * n,
    high: 800 * n,
    longFormViews: 100_000 * n,
    shortsViews: 0,
    belowAdThreshold: false,
    rateTier: UNKNOWN_TIER,
  },
  ninetyDayViews: 250_000 * n,
  ninetyDayUploads: 25,
  ninetyDayEarnings: {
    low: 500 * n,
    high: 2000 * n,
    longFormViews: 250_000 * n,
    shortsViews: 0,
    belowAdThreshold: false,
    rateTier: UNKNOWN_TIER,
  },
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
  ...overrides,
});

const listOf = (channels: readonly NicheChannel[], channelsChecked = 286): NicheList => ({
  channels,
  channelsChecked,
  smallMaxSubscribers: 10_000,
  newMaxAgeDays: 90,
});

describe('filterNiches', () => {
  const channels = [
    niche(1),
    niche(2, { reasons: ['small'], watched: true }),
    niche(3, { reasons: ['new'] }),
    niche(4, { reasons: [], qualifies: false, watched: true }),
  ];
  const kept = (filter: Parameters<typeof filterNiches>[1]) =>
    filterNiches(channels, filter).map((channel) => channel.id);

  test('offers every channel, the new ones, the small ones, or the watched ones', () => {
    expect(NICHE_FILTERS.map((option) => option.id)).toEqual([
      'all',
      'new',
      'small',
      'language',
      'watched',
    ]);
  });

  test('keeps the channels that write in another alphabet', () => {
    const mixed = [niche(1), niche(2, { otherLanguage: { script: 'Cyrillic' } })];

    expect(filterNiches(mixed, 'language').map((channel) => channel.id)).toEqual([cid(2)]);
  });

  test('keeps everything by default, in the order given', () => {
    expect(filterNiches(channels, 'all')).toEqual(channels);
  });

  test('keeps the new channels, whether or not they are also small', () => {
    expect(kept('new')).toEqual([cid(1), cid(3)]);
  });

  test('keeps the small channels, whether or not they are also new', () => {
    expect(kept('small')).toEqual([cid(1), cid(2)]);
  });

  test('keeps only the channels the owner is watching', () => {
    expect(kept('watched')).toEqual([cid(2), cid(4)]);
  });
});

describe('withWatched', () => {
  test('marks one channel without touching the list it was given', () => {
    const before = listOf([niche(1), niche(2)]);

    const after = withWatched(before, cid(2), true);

    expect(after.channels.map((channel) => channel.watched)).toEqual([false, true]);
    expect(before.channels.map((channel) => channel.watched)).toEqual([false, false]);
    expect(after.channelsChecked).toBe(286);
  });

  test('unmarks a channel and leaves an unknown id alone', () => {
    const before = listOf([niche(1, { watched: true })]);

    expect(withWatched(before, cid(1), false).channels[0]?.watched).toBe(false);
    expect(withWatched(before, cid(9), false)).toEqual(before);
  });
});

describe('describing niches in words', () => {
  test('says how new a channel is, when that is known', () => {
    expect(describeOrigin(niche(1))).toBe('First upload about 4 weeks ago');
    expect(describeOrigin(niche(1, { channelAgeDays: 9 }))).toBe('First upload about 9 days ago');
    expect(describeOrigin(niche(1, { channelAgeDays: null }))).toBe('');
  });

  test('says when the account is much older than the channel that restarted on it', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const old = niche(1, { channelAgeDays: 61, createdAt: '2018-03-04T10:00:00.000Z' });

    expect(describeOrigin(old, now)).toBe('Account from 2018, restarted 2 months ago');
    expect(describeOrigin({ ...old, country: 'US' }, now)).toBe(
      'Account from 2018, restarted 2 months ago · United States',
    );
  });

  test('keeps to the first upload when the account was made around the same time', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const fresh = niche(1, { channelAgeDays: 30, createdAt: '2026-09-01T00:00:00.000Z' });
    const justOver = niche(1, { channelAgeDays: 30, createdAt: '2026-08-20T00:00:00.000Z' });

    expect(describeOrigin(fresh, now)).toBe('First upload about 4 weeks ago');
    expect(describeOrigin(justOver, now)).toBe('Account from 2026, restarted 4 weeks ago');
  });

  test('gives the account year alone when the first upload is not known', () => {
    const capped = niche(1, { channelAgeDays: null, createdAt: '2015-06-01T00:00:00.000Z' });

    expect(describeOrigin(capped)).toBe('Account from 2015');
  });

  test('names the country when it is known, and leaves out a code it cannot read', () => {
    expect(describeOrigin(niche(1, { country: 'GB' }))).toBe(
      'First upload about 4 weeks ago · United Kingdom',
    );
    expect(describeOrigin(niche(1, { country: 'not a country' }))).toBe(
      'First upload about 4 weeks ago',
    );
    expect(describeOrigin(niche(1, { country: 'ZZ', channelAgeDays: null }))).toBe('');
  });

  test('ignores an account date it cannot read', () => {
    expect(describeOrigin(niche(1, { createdAt: 'yesterday-ish' }))).toBe(
      'First upload about 4 weeks ago',
    );
  });

  test('says how many channels were found, what new and small mean, and among how many', () => {
    expect(describeList(listOf([niche(1), niche(2)]))).toBe(
      '2 channels that are new (first upload in the last 90 days) or small (10K subscribers or fewer) with a recent video far above their size or their usual views, found among the 286 channels Jgtube has read. Most views on the last 90 days of uploads first.',
    );
    expect(describeList(listOf([niche(1)], 1))).toBe(
      '1 channel that is new (first upload in the last 90 days) or small (10K subscribers or fewer) with a recent video far above its size or its usual views, found among the 1 channel Jgtube has read. Most views on the last 90 days of uploads first.',
    );
  });

  test('says what the list is for while it is empty', () => {
    expect(describeList(listOf([]))).toBe(
      'New or small channels with a recent video far above their size or their usual views, from every channel Jgtube has read.',
    );
  });

  test('says how often a channel’s videos take off', () => {
    expect(describeHits(niche(1))).toBe('2 of 9 recent videos took off');
    expect(describeHits(niche(1, { hitCount: 1, scoredCount: 1 }))).toBe(
      '1 of 1 recent video took off',
    );
    expect(describeHits(niche(1, { hitCount: 0, scoredCount: 0 }))).toBe(
      'Too few videos to tell a one-off from a pattern',
    );
  });

  test('writes views per subscriber, or a dash when the count is hidden', () => {
    expect(formatPerSubscriber(353.9)).toBe('354');
    expect(formatPerSubscriber(1327.4)).toBe('1.3K');
    expect(formatPerSubscriber(2.14)).toBe('2.1');
    expect(formatPerSubscriber(null)).toBe('—');
  });

  test('lists the sample titles that are not already shown as videos that took off', () => {
    const sample = (n: number) => ({ videoId: vid(n), title: `Video ${n}`, views: 1000 * n });
    const took = {
      ...sample(2),
      score: 30,
      publishedRaw: '2d ago',
      ageDays: 2,
      durationSeconds: 600,
    };
    const channel = niche(1, {
      outperformers: [took],
      sampleTitles: [sample(3), sample(2), sample(1)],
    });

    expect(otherTitles(channel)).toEqual([sample(3), sample(1)]);
    expect(otherTitles(niche(1))).toEqual([]);
  });
});

describe('api for niches', () => {
  test('reads the niche list', async () => {
    const urls: string[] = [];
    const list = listOf([niche(1)]);
    const api = createApi(async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ success: true, data: list, error: null }));
    });

    await expect(api.niches()).resolves.toEqual(list);
    expect(urls).toEqual(['/api/niches']);
  });

  test('sends a watch choice as JSON', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createApi(async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ success: true, data: {}, error: null }));
    });

    await api.setNicheWatched(cid(1), true);

    expect(calls[0]?.url).toBe('/api/niches/watch');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ channel: cid(1), watched: true });
  });

  test('raises the server message when a watch choice is refused', async () => {
    const api = createApi(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            data: null,
            error: 'That channel has not been read yet',
          }),
          { status: 404 },
        ),
    );

    await expect(api.setNicheWatched(cid(1), true)).rejects.toThrow(/not been read/);
  });
});

describe('describeEarnings', () => {
  const worth = (low: number, high: number, belowAdThreshold: boolean | null = false) => ({
    low,
    high,
    longFormViews: 1,
    shortsViews: 0,
    belowAdThreshold,
    rateTier: UNKNOWN_TIER,
  });

  test('gives the monthly range in short dollar figures', () => {
    expect(describeEarnings(worth(84, 338))).toBe(
      'Views on the last 30 days of uploads are worth about $84–$338',
    );
    expect(describeEarnings(worth(1200, 4900))).toBe(
      'Views on the last 30 days of uploads are worth about $1.2K–$4.9K',
    );
  });

  test('says when a channel is too small to earn from ads yet', () => {
    expect(describeEarnings(worth(84, 338, true))).toBe(
      'Views on the last 30 days of uploads are worth about $84–$338, but under 1,000 subscribers it cannot earn from ads yet',
    );
  });

  test('says so when there is nothing to estimate from', () => {
    expect(describeEarnings(worth(0, 0))).toBe('No uploads in the last 30 days to estimate from');
  });

  test('speaks of the 90 days when given the longer window', () => {
    expect(describeEarnings(worth(500, 2000), 90)).toBe(
      'Views on the last 90 days of uploads are worth about $500–$2K',
    );
    expect(describeEarnings(worth(0, 0), 90)).toBe(
      'No uploads in the last 90 days to estimate from',
    );
  });
});

describe('describeRateTier', () => {
  test('says the top rate was assumed when the country is not known', () => {
    expect(describeRateTier(UNKNOWN_TIER)).toBe('Country unknown, so the top ad rate was assumed');
  });

  test('names the tier and the country it was read from', () => {
    expect(describeRateTier({ id: 'top', multiplier: 1, country: 'US' })).toBe(
      'Top ad-rate tier (United States)',
    );
    expect(describeRateTier({ id: 'developed', multiplier: 0.5, country: 'FR' })).toBe(
      'Middle ad-rate tier (France): counted at 50% of the top rate',
    );
    expect(describeRateTier({ id: 'emerging', multiplier: 0.2, country: 'ZA' })).toBe(
      'Lower ad-rate tier (South Africa): counted at 20% of the top rate',
    );
  });
});

describe('describeLanguage', () => {
  test('names the alphabet when it is known', () => {
    expect(describeLanguage({ script: 'Cyrillic' })).toBe('Other language · Cyrillic');
    expect(describeLanguage({ script: null })).toBe('Other language');
  });
});

describe('describeSearch', () => {
  test('sums up what a keyword search found', () => {
    expect(
      describeSearch({
        keyword: 'new invention',
        videosFound: 50,
        channelsFound: 30,
        added: 14,
        alreadyKnown: 1,
        failed: 0,
        factsAdded: 0,
        factsProblem: null,
      }),
    ).toBe(
      'Found 50 videos from 30 channels for "new invention": 14 new to Jgtube, 1 already known.',
    );
  });

  test('mentions channels that could not be read, and a search that found nothing', () => {
    expect(
      describeSearch({
        keyword: 'x',
        videosFound: 3,
        channelsFound: 2,
        added: 1,
        alreadyKnown: 0,
        failed: 1,
        factsAdded: 0,
        factsProblem: null,
      }),
    ).toBe(
      'Found 3 videos from 2 channels for "x": 1 new to Jgtube, 0 already known, 1 could not be read.',
    );
    expect(
      describeSearch({
        keyword: 'x',
        videosFound: 0,
        channelsFound: 0,
        added: 0,
        alreadyKnown: 0,
        failed: 0,
        factsAdded: 0,
        factsProblem: null,
      }),
    ).toBe('No recent videos were found for "x".');
  });
});

describe('account dates read after a search', () => {
  const found = {
    keyword: 'x',
    videosFound: 3,
    channelsFound: 2,
    added: 2,
    alreadyKnown: 0,
    failed: 0,
    factsAdded: 0,
    factsProblem: null,
  };

  test('are not mentioned when they were read, or not asked for', () => {
    expect(describeSearch({ ...found, factsAdded: 2 })).toBe(
      'Found 3 videos from 2 channels for "x": 2 new to Jgtube, 0 already known.',
    );
  });

  test('say why when they could not be read', () => {
    expect(describeSearch({ ...found, factsProblem: 'No allowance left.' })).toBe(
      'Found 3 videos from 2 channels for "x": 2 new to Jgtube, 0 already known. Account dates could not be read: No allowance left.',
    );
  });
});

describe('the niche calls of the API client', () => {
  test('asks for a keyword search and returns its counts', async () => {
    const bodies: string[] = [];
    const summary = {
      keyword: 'k',
      videosFound: 1,
      channelsFound: 1,
      added: 1,
      alreadyKnown: 0,
      failed: 0,
      factsAdded: 0,
      factsProblem: null,
    };
    const api = createApi(async (url, init) => {
      bodies.push(`${String(url)} ${String(init?.body)}`);
      return new Response(JSON.stringify({ success: true, data: summary, error: null }));
    });

    expect(await api.discoverNiches('k')).toEqual(summary);
    expect(bodies).toEqual(['/api/niches/discover {"keyword":"k"}']);
  });
});

import type { NicheChannel, NicheList } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApi } from '../src/lib/api';
import {
  NICHE_FILTERS,
  describeChannel,
  describeHits,
  describeList,
  filterNiches,
  formatPerSubscriber,
  otherTitles,
  withWatched,
} from '../src/lib/niches';

const cid = (n: number) => `UC${String(n).padStart(22, '0')}`;
const vid = (n: number) => `video${String(n).padStart(6, '0')}`;

const niche = (n: number, overrides: Partial<NicheChannel> = {}): NicheChannel => ({
  id: cid(n),
  title: `Channel ${n}`,
  handle: `handle${n}`,
  subscribers: 1000 * n,
  recentViews: 100_000 * n,
  recentUploads: 10,
  viewsPerSubscriber: 100,
  channelAgeDays: 30,
  reasons: ['new', 'small'],
  outperformers: [],
  hitCount: 2,
  scoredCount: 9,
  sampleTitles: [],
  qualifies: true,
  watched: false,
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
    expect(NICHE_FILTERS.map((option) => option.id)).toEqual(['all', 'new', 'small', 'watched']);
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
  test('says who a channel is and how new it is', () => {
    expect(describeChannel(niche(1))).toBe('@handle1 · first upload about 4 weeks ago');
    expect(describeChannel(niche(1, { handle: null, channelAgeDays: 9 }))).toBe(
      'first upload about 9 days ago',
    );
    expect(describeChannel(niche(1, { channelAgeDays: null }))).toBe('@handle1');
    expect(describeChannel(niche(1, { handle: null, channelAgeDays: null }))).toBe('');
  });

  test('says how many channels were found, what new and small mean, and among how many', () => {
    expect(describeList(listOf([niche(1), niche(2)]))).toBe(
      '2 channels that are new (first upload in the last 90 days) or small (10K subscribers or fewer) with a recent video far above their size or their usual views, found among the 286 channels Jgtube has read. Most views first.',
    );
    expect(describeList(listOf([niche(1)], 1))).toBe(
      '1 channel that is new (first upload in the last 90 days) or small (10K subscribers or fewer) with a recent video far above its size or its usual views, found among the 1 channel Jgtube has read. Most views first.',
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

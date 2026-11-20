import { describe, expect, test } from 'vitest';
import type { QuotaKind } from '../src/quota/kinds';
import {
  REQUEST_TIMEOUT_MS,
  SEARCH_COST_UNITS,
  fetchChannels,
  fetchPlaylistVideoIds,
  fetchVideos,
  searchRecentVideos,
} from '../src/youtube/dataApi';
import { YouTubeApiError } from '../src/youtube/client';
import {
  PLAYLIST_NOT_FOUND,
  QUOTA_EXCEEDED,
  SEARCH_REPLY,
  channelId,
  channelItem,
  channelsReply,
  keyRefused,
  playlistReply,
  uploadsId,
  videoId,
  videoItem,
  videosReply,
  searchItem,
} from './fixtures/apiReplies';

const KEY = 'test-key-not-a-real-one';
const SINCE = new Date('2026-11-17T00:00:00Z');

interface Call {
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal | null;
}

/**
 * A stand-in for the network and the ledger: it answers with the given bodies
 * in turn and writes down, in order, every spend and every request.
 */
function fakeApi(replies: ReadonlyArray<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const spends: Array<{ kind: QuotaKind; units: number }> = [];
  const order: string[] = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    order.push('request');
    calls.push({
      url: new URL(String(url)),
      headers: { ...(init?.headers as Record<string, string>) },
      signal: init?.signal ?? null,
    });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)] ?? { body: {} };
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  const spend = (kind: QuotaKind, units: number): void => {
    order.push('spend');
    spends.push({ kind, units });
  };
  return { options: { apiKey: KEY, fetch: fetcher, spend }, calls, spends, order };
}

/** Turns the failure a list call reports into a rejection, for the tests about refusals. */
async function rejected(call: Promise<{ readonly error: Error | null }>): Promise<void> {
  const { error } = await call;
  if (error !== null) throw error;
}

const param = (call: Call | undefined, name: string) => call?.url.searchParams.get(name);
const search = {
  order: 'viewCount',
  publishedAfter: SINCE,
  regionCode: 'US',
  shortOnly: true,
} as const;

describe('searchRecentVideos', () => {
  test('returns the readable videos of one page, leaving out anything else', async () => {
    const api = fakeApi([{ body: SEARCH_REPLY }]);

    const { hits } = await searchRecentVideos('quick how-to', { ...api.options, ...search });

    expect(hits.map((hit) => hit.videoId)).toEqual([videoId(1), videoId(2), videoId(3)]);
    expect(hits[0]).toEqual({
      videoId: videoId(1),
      channelId: channelId('A'),
      channelTitle: 'Channel A',
      title: 'Folding a paper crane in 40 seconds',
      publishedAt: new Date('2026-11-18T15:30:00Z'),
      rank: 1,
    });
  });

  test('gives each video its place in the results, counting the entries it could not read', async () => {
    const api = fakeApi([{ body: SEARCH_REPLY }]);

    const found = await searchRecentVideos('quick how-to', { ...api.options, ...search });

    // The third entry of the reply is not a video, so the last video is fourth.
    expect(found.hits.map((hit) => hit.rank)).toEqual([1, 2, 4]);
    expect(found).toMatchObject({ skipped: 1, fullPage: false });
  });

  test('says when a page came back full, and asks for the newest first when told to', async () => {
    const items = Array.from({ length: 50 }, (_, n) => searchItem(n, 'A', `Made-up title ${n}`));
    const api = fakeApi([{ body: { items } }]);

    const found = await searchRecentVideos('quick how-to', {
      ...api.options,
      ...search,
      order: 'date',
    });

    expect(found.fullPage).toBe(true);
    expect(found.hits.at(-1)?.rank).toBe(50);
    expect(param(api.calls[0], 'order')).toBe('date');
  });

  test('asks for the most-viewed short videos in one country since a date', async () => {
    const api = fakeApi([{ body: SEARCH_REPLY }]);

    await searchRecentVideos('  quick how-to ', {
      ...api.options,
      ...search,
      regionCode: 'GB',
      relevanceLanguage: 'en',
    });

    const call = api.calls[0];
    expect(call?.url.pathname).toBe('/youtube/v3/search');
    expect(Object.fromEntries(call?.url.searchParams ?? [])).toEqual({
      part: 'snippet',
      type: 'video',
      q: 'quick how-to',
      order: 'viewCount',
      publishedAfter: '2026-11-17T00:00:00.000Z',
      regionCode: 'GB',
      relevanceLanguage: 'en',
      videoDuration: 'short',
      maxResults: '50',
    });
  });

  test('leaves the length and the language open when not asked to narrow them', async () => {
    const api = fakeApi([{ body: SEARCH_REPLY }]);

    await searchRecentVideos('quick how-to', { ...api.options, ...search, shortOnly: false });

    expect(param(api.calls[0], 'videoDuration')).toBeNull();
    expect(param(api.calls[0], 'relevanceLanguage')).toBeNull();
  });

  test('counts 100 units as a search before the request goes out', async () => {
    const api = fakeApi([{ body: SEARCH_REPLY }]);

    await searchRecentVideos('quick how-to', { ...api.options, ...search });

    expect(api.spends).toEqual([{ kind: 'search', units: SEARCH_COST_UNITS }]);
    expect(SEARCH_COST_UNITS).toBe(100);
    expect(api.order).toEqual(['spend', 'request']);
  });

  test('makes no request when the ledger refuses the spend', async () => {
    const api = fakeApi([{ body: SEARCH_REPLY }]);
    const spend = (): void => {
      throw new Error('the allowance is spent');
    };

    const attempt = searchRecentVideos('quick how-to', { ...api.options, ...search, spend });

    await expect(attempt).rejects.toThrow('the allowance is spent');
    expect(api.calls).toHaveLength(0);
  });

  test('waits for a ledger that answers later', async () => {
    const api = fakeApi([{ body: SEARCH_REPLY }]);
    const waited: string[] = [];
    const spend = async (): Promise<void> => {
      await Promise.resolve();
      waited.push(`requests so far: ${api.calls.length}`);
    };

    await searchRecentVideos('quick how-to', { ...api.options, ...search, spend });

    expect(waited).toEqual(['requests so far: 0']);
  });

  test('can be paid for from another share of the plan, such as the units kept back', async () => {
    const api = fakeApi([{ body: SEARCH_REPLY }]);

    await searchRecentVideos('quick how-to', { ...api.options, ...search, kind: 'reserve' });

    expect(api.spends).toEqual([{ kind: 'reserve', units: 100 }]);
  });

  test.each([
    ['an empty search', { query: '   ' }],
    ['a search that is too long', { query: 'x'.repeat(201) }],
    ['a country that is not two letters', { regionCode: 'USA' }],
    ['a language that is not a language code', { relevanceLanguage: 'english!' }],
    ['a date that is not a date', { publishedAfter: new Date('nonsense') }],
  ])('refuses %s without spending anything', async (_what, bad) => {
    const api = fakeApi([{ body: SEARCH_REPLY }]);
    const { query = 'quick how-to', ...rest } = bad as { query?: string };

    await expect(
      searchRecentVideos(query, { ...api.options, ...search, ...rest }),
    ).rejects.toThrow();
    expect(api.spends).toEqual([]);
    expect(api.calls).toHaveLength(0);
  });
});

describe('fetchVideos', () => {
  test('reads the length, the exact time, the category, the languages, the views, the likes and the comments', async () => {
    const api = fakeApi([{ body: videosReply([videoItem(1, 'A')]) }]);

    const { items: videos } = await fetchVideos([videoId(1)], api.options);

    expect(videos).toEqual([
      {
        id: videoId(1),
        channelId: channelId('A'),
        title: 'Fixing a slipping bicycle chain',
        publishedAt: new Date('2026-11-18T15:30:00Z'),
        durationSeconds: 42,
        categoryId: '26',
        defaultLanguage: 'en',
        defaultAudioLanguage: 'en-GB',
        views: 184_223,
        likes: 9120,
        comments: 311,
      },
    ]);
    expect(api.calls[0]?.url.pathname).toBe('/youtube/v3/videos');
    expect(param(api.calls[0], 'part')).toBe('snippet,contentDetails,statistics');
    expect(param(api.calls[0], 'id')).toBe(videoId(1));
  });

  test('reports a hidden view count as unknown, not as zero', async () => {
    const hidden = videoItem(1, 'A', { statistics: { favoriteCount: '0' } });
    const bare = videoItem(2, 'B', { statistics: undefined });
    const api = fakeApi([{ body: videosReply([hidden, bare]) }]);

    const { items: videos } = await fetchVideos([videoId(1), videoId(2)], api.options);

    expect(videos.map((video) => video.views)).toEqual([null, null]);
  });

  test('reports what the uploader left unset as unknown', async () => {
    const plain = videoItem(1, 'A', {
      snippet: {
        publishedAt: '2026-11-18T15:30:00Z',
        channelId: channelId('A'),
        title: 'Shaping a sourdough loaf',
      },
    });
    const api = fakeApi([{ body: videosReply([plain]) }]);

    const video = (await fetchVideos([videoId(1)], api.options)).items[0];

    expect(video).toMatchObject({
      categoryId: null,
      defaultLanguage: null,
      defaultAudioLanguage: null,
    });
  });

  test('gives a live broadcast, which has no length yet, an unknown length', async () => {
    const live = videoItem(1, 'A', { contentDetails: { duration: 'P0D' } });
    const odd = videoItem(2, 'A', { contentDetails: { duration: 'about a minute' } });
    const api = fakeApi([{ body: videosReply([live, odd]) }]);

    const { items: videos } = await fetchVideos([videoId(1), videoId(2)], api.options);

    expect(videos.map((video) => video.durationSeconds)).toEqual([null, null]);
  });

  test('asks for at most fifty videos in one request, one unit each time', async () => {
    const ids = Array.from({ length: 120 }, (_, n) => videoId(n));
    const api = fakeApi([{ body: videosReply([]) }]);

    await fetchVideos(ids, api.options);

    expect(api.calls).toHaveLength(3);
    expect(param(api.calls[2], 'id')?.split(',')).toHaveLength(20);
    expect(api.spends).toEqual(Array.from({ length: 3 }, () => ({ kind: 'reading', units: 1 })));
    expect(api.order).toEqual(['spend', 'request', 'spend', 'request', 'spend', 'request']);
  });

  test('asks for a video named twice only once', async () => {
    const api = fakeApi([{ body: videosReply([videoItem(1, 'A')]) }]);

    await fetchVideos([videoId(1), videoId(1)], api.options);

    expect(param(api.calls[0], 'id')).toBe(videoId(1));
  });

  test('makes no request and spends nothing for an empty list', async () => {
    const api = fakeApi([{ body: videosReply([]) }]);

    expect((await fetchVideos([], api.options)).items).toEqual([]);
    expect(api.calls).toHaveLength(0);
    expect(api.spends).toEqual([]);
  });

  test('leaves out an entry it cannot read', async () => {
    const broken = { kind: 'youtube#video', id: videoId(9), snippet: { title: 42 } };
    const api = fakeApi([{ body: videosReply([broken, videoItem(1, 'A')]) }]);

    const { items: videos } = await fetchVideos([videoId(9), videoId(1)], api.options);

    expect(videos.map((video) => video.id)).toEqual([videoId(1)]);
  });

  test('refuses something that is not a video id', async () => {
    const api = fakeApi([{ body: videosReply([]) }]);

    await expect(fetchVideos(['not an id'], api.options)).rejects.toThrow(/valid YouTube video id/);
    expect(api.spends).toEqual([]);
  });
});

describe('fetchChannels', () => {
  test('reads when a channel was created, where it is, how big it is and its uploads list', async () => {
    const api = fakeApi([{ body: channelsReply([channelItem('A')]) }]);

    const { items: channels } = await fetchChannels([channelId('A')], api.options);

    expect(channels).toEqual([
      {
        id: channelId('A'),
        title: 'Channel A',
        createdAt: new Date('2026-09-01T10:00:00Z'),
        country: 'GB',
        totalViews: 123_456,
        videoCount: 12,
        subscribers: 890,
        subscribersHidden: false,
        uploadsPlaylistId: uploadsId('A'),
      },
    ]);
    expect(api.calls[0]?.url.pathname).toBe('/youtube/v3/channels');
    expect(param(api.calls[0], 'part')).toBe('snippet,statistics,contentDetails');
  });

  test('reports a hidden subscriber count as unknown, not as zero', async () => {
    const hidden = channelItem('A', {
      statistics: { viewCount: '500', hiddenSubscriberCount: true, subscriberCount: '0' },
    });
    const api = fakeApi([{ body: channelsReply([hidden]) }]);

    const channel = (await fetchChannels([channelId('A')], api.options)).items[0];

    expect(channel).toMatchObject({ subscribers: null, subscribersHidden: true, videoCount: null });
  });

  test('copes with a channel that names no country, no uploads list and no figures', async () => {
    const bare = {
      id: channelId('A'),
      snippet: { title: 'Channel A', publishedAt: '2026-09-01T10:00:00Z' },
    };
    const api = fakeApi([{ body: channelsReply([bare]) }]);

    const channel = (await fetchChannels([channelId('A')], api.options)).items[0];

    expect(channel).toMatchObject({
      country: null,
      totalViews: null,
      subscribers: null,
      subscribersHidden: false,
      uploadsPlaylistId: null,
    });
  });

  test('asks for at most fifty channels in one request, one unit each time', async () => {
    const ids = Array.from({ length: 51 }, (_, n) => `UC${String(n).padStart(22, 'x')}`);
    const api = fakeApi([{ body: channelsReply([]) }]);

    await fetchChannels(ids, api.options);

    expect(api.calls).toHaveLength(2);
    expect(api.spends).toEqual([
      { kind: 'channel', units: 1 },
      { kind: 'channel', units: 1 },
    ]);
  });

  test('returns nothing for channels the API does not know', async () => {
    const api = fakeApi([{ body: { kind: 'youtube#channelListResponse', pageInfo: {} } }]);

    expect((await fetchChannels([channelId('Z')], api.options)).items).toEqual([]);
  });

  test('refuses something that is not a channel id', async () => {
    const api = fakeApi([{ body: channelsReply([]) }]);

    await expect(fetchChannels(['@a-handle'], api.options)).rejects.toThrow(
      /valid YouTube channel id/,
    );
    expect(api.calls).toHaveLength(0);
  });
});

describe('fetchPlaylistVideoIds', () => {
  test('follows the list page by page, one unit a page', async () => {
    const api = fakeApi([
      { body: playlistReply([1, 2], 'page-two') },
      { body: playlistReply([3]) },
    ]);

    const result = await fetchPlaylistVideoIds(uploadsId('A'), { ...api.options, maxPages: 5 });

    expect(result).toEqual({
      videoIds: [videoId(1), videoId(2), videoId(3)],
      notFound: false,
      complete: true,
      skipped: 0,
    });
    expect(api.calls[0]?.url.pathname).toBe('/youtube/v3/playlistItems');
    expect(Object.fromEntries(api.calls[0]?.url.searchParams ?? [])).toEqual({
      part: 'contentDetails',
      playlistId: uploadsId('A'),
      maxResults: '50',
    });
    expect(param(api.calls[1], 'pageToken')).toBe('page-two');
    expect(api.spends).toEqual([
      { kind: 'channel', units: 1 },
      { kind: 'channel', units: 1 },
    ]);
    expect(api.order).toEqual(['spend', 'request', 'spend', 'request']);
  });

  test('stops at the page limit and says the list goes on', async () => {
    const api = fakeApi([{ body: playlistReply([1, 2], 'more') }]);

    const result = await fetchPlaylistVideoIds(uploadsId('A'), { ...api.options, maxPages: 2 });

    expect(result.videoIds).toHaveLength(4);
    expect(result.complete).toBe(false);
    expect(api.calls).toHaveLength(2);
  });

  test('reports a list the API does not know as not found, without failing', async () => {
    const api = fakeApi([{ status: 404, body: PLAYLIST_NOT_FOUND }]);

    const result = await fetchPlaylistVideoIds(`UUSH${'A'.repeat(22)}`, {
      ...api.options,
      maxPages: 1,
    });

    expect(result).toEqual({ videoIds: [], notFound: true, complete: true, skipped: 0 });
    expect(api.spends).toEqual([{ kind: 'channel', units: 1 }]);
  });

  test('still fails on any other refusal', async () => {
    const api = fakeApi([{ status: 403, body: QUOTA_EXCEEDED }]);

    const attempt = fetchPlaylistVideoIds(uploadsId('A'), { ...api.options, maxPages: 1 });

    await expect(attempt).rejects.toThrow(/daily allowance/);
  });

  test('skips an entry with no readable video id', async () => {
    const reply = {
      items: [{ contentDetails: {} }, { contentDetails: { videoId: videoId(7) } }],
    };
    const api = fakeApi([{ body: reply }]);

    const result = await fetchPlaylistVideoIds(uploadsId('A'), { ...api.options, maxPages: 1 });

    expect(result.videoIds).toEqual([videoId(7)]);
  });

  test.each([
    ['a list id with characters no id has', 'UU bad/id', 1],
    ['a page limit below one', uploadsId('A'), 0],
    ['a fractional page limit', uploadsId('A'), 1.5],
  ])('refuses %s', async (_what, playlistId, maxPages) => {
    const api = fakeApi([{ body: playlistReply([1]) }]);

    await expect(fetchPlaylistVideoIds(playlistId, { ...api.options, maxPages })).rejects.toThrow();
    expect(api.calls).toHaveLength(0);
  });
});

describe('every request', () => {
  test('sends the key in a header, never in the address', async () => {
    const api = fakeApi([{ body: channelsReply([]) }]);

    await fetchChannels([channelId('A')], api.options);

    expect(api.calls[0]?.url.href).not.toContain(KEY);
    expect(api.calls[0]?.headers['x-goog-api-key']).toBe(KEY);
  });

  test('gives up after twenty seconds', async () => {
    const api = fakeApi([{ body: channelsReply([]) }]);

    await fetchChannels([channelId('A')], api.options);

    expect(REQUEST_TIMEOUT_MS).toBe(20_000);
    expect(api.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  test('says so plainly when the API does not answer in time', async () => {
    const api = fakeApi([]);
    const fetcher = async (): Promise<Response> => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };

    const attempt = rejected(fetchVideos([videoId(1)], { ...api.options, fetch: fetcher }));

    await expect(attempt).rejects.toThrow('The YouTube API did not answer within 20 seconds');
  });

  test('keeps the key out of the message when the network fails', async () => {
    const api = fakeApi([]);
    const fetcher = async (): Promise<Response> => {
      throw new TypeError(`fetch failed for a request carrying ${KEY}`);
    };

    const attempt = rejected(fetchVideos([videoId(1)], { ...api.options, fetch: fetcher }));

    await expect(attempt).rejects.toThrow(/could not be reached: fetch failed.*\[key\]/);
    await expect(attempt).rejects.not.toThrow(new RegExp(KEY));
  });

  test('explains a used-up allowance in plain words', async () => {
    const api = fakeApi([{ status: 403, body: QUOTA_EXCEEDED }]);

    const attempt = rejected(fetchVideos([videoId(1)], api.options));

    await expect(attempt).rejects.toThrow(
      'The YouTube API key has used up its daily allowance. It resets at midnight Pacific time.',
    );
    await expect(attempt).rejects.toMatchObject({ status: 403, quotaSpent: true });
  });

  test('strips the key from a refusal and keeps the status', async () => {
    const api = fakeApi([{ status: 400, body: keyRefused(KEY) }]);

    const attempt = rejected(fetchChannels([channelId('A')], api.options));

    await expect(attempt).rejects.toBeInstanceOf(YouTubeApiError);
    await expect(attempt).rejects.toThrow(
      /refused the request \(400\): API key not valid: \[key\]/,
    );
    await expect(attempt).rejects.toMatchObject({ status: 400, quotaSpent: false });
  });

  test('cuts a long refusal short', async () => {
    const body = { error: { message: 'x'.repeat(5000) } };
    const api = fakeApi([{ status: 500, body }]);

    const message = await rejected(fetchChannels([channelId('A')], api.options)).then(
      () => '',
      (error: Error) => error.message,
    );

    expect(message.length).toBeLessThan(300);
  });

  test('copes with a refusal that is not JSON', async () => {
    const fetcher = async (): Promise<Response> =>
      new Response('<html>Bad gateway</html>', { status: 502 });
    const api = fakeApi([]);

    const attempt = rejected(fetchChannels([channelId('A')], { ...api.options, fetch: fetcher }));

    await expect(attempt).rejects.toThrow(/refused the request \(502\)/);
  });

  test.each([
    ['is not JSON', 'not json at all'],
    ['is not the shape the API documents', JSON.stringify({ items: 'none' })],
  ])('fails clearly on a reply that %s', async (_what, text) => {
    const fetcher = async (): Promise<Response> => new Response(text, { status: 200 });
    const api = fakeApi([]);

    const attempt = rejected(fetchChannels([channelId('A')], { ...api.options, fetch: fetcher }));

    await expect(attempt).rejects.toThrow('The YouTube API sent a reply that could not be read');
  });

  test('refuses to start without a key, before spending anything', async () => {
    const api = fakeApi([{ body: channelsReply([]) }]);

    const attempt = rejected(fetchChannels([channelId('A')], { ...api.options, apiKey: '  ' }));

    await expect(attempt).rejects.toThrow(/No YouTube API key is set/);
    expect(api.spends).toEqual([]);
  });
});

describe('a read of many ids that fails part of the way', () => {
  test('keeps the videos already read and names the ones that were not', async () => {
    const ids = Array.from({ length: 120 }, (_, n) => videoId(n));
    const api = fakeApi([
      { body: videosReply([videoItem(1, 'A')]) },
      { status: 500, body: { error: { message: 'backend error' } } },
    ]);

    const result = await fetchVideos(ids, api.options);

    expect(result.items.map((video) => video.id)).toEqual([videoId(1)]);
    expect(result.failedIds).toEqual(ids.slice(50));
    expect(result.error?.message).toMatch(/refused the request \(500\)/);
    expect(api.calls).toHaveLength(2);
  });

  test('keeps the channels already read when the ledger refuses the next request', async () => {
    const ids = Array.from({ length: 51 }, (_, n) => `UC${String(n).padStart(22, 'x')}`);
    const api = fakeApi([{ body: channelsReply([channelItem('A')]) }]);
    let spends = 0;
    const spend = (): void => {
      spends += 1;
      if (spends > 1) throw new Error('the allowance is spent');
    };

    const result = await fetchChannels(ids, { ...api.options, spend });

    expect(result.items).toHaveLength(1);
    expect(result.failedIds).toEqual(ids.slice(50));
    expect(result.error?.message).toBe('the allowance is spent');
    expect(api.calls).toHaveLength(1);
  });

  test('reports a failure that is not an Error as one', async () => {
    const api = fakeApi([{ body: videosReply([]) }]);
    const spend = (): void => {
      throw 'a bare string';
    };

    const result = await fetchVideos([videoId(1)], { ...api.options, spend });

    expect(result.error?.message).toBe('a bare string');
    expect(result.failedIds).toEqual([videoId(1)]);
  });
});

describe('entries that cannot be read', () => {
  test('are counted, for a search, a video read, a channel read and a list', async () => {
    const brokenVideo = { kind: 'youtube#video', id: videoId(9), snippet: { title: 42 } };
    const brokenChannel = { id: 'not a channel id' };

    const found = await searchRecentVideos('quick how-to', {
      ...fakeApi([{ body: SEARCH_REPLY }]).options,
      ...search,
    });
    const videos = await fetchVideos(
      [videoId(9), videoId(1)],
      fakeApi([{ body: videosReply([brokenVideo, videoItem(1, 'A')]) }]).options,
    );
    const channels = await fetchChannels(
      [channelId('A')],
      fakeApi([{ body: channelsReply([brokenChannel]) }]).options,
    );
    const list = await fetchPlaylistVideoIds(uploadsId('A'), {
      ...fakeApi([{ body: { items: [{ contentDetails: {} }] } }]).options,
      maxPages: 1,
    });

    expect(found.skipped).toBe(1);
    expect(videos).toMatchObject({ skipped: 1, failedIds: [], error: null });
    expect(channels).toMatchObject({ items: [], skipped: 1 });
    expect(list.skipped).toBe(1);
  });

  test('keeps a video whose optional fields are in a shape not expected, reading them as unset', async () => {
    const odd = videoItem(1, 'A', {
      snippet: {
        publishedAt: '2026-11-18T15:30:00Z',
        channelId: channelId('A'),
        title: 'Shaping a sourdough loaf',
        categoryId: 26,
        defaultLanguage: '',
        defaultAudioLanguage: 'x'.repeat(40),
      },
      contentDetails: 'none',
      statistics: { viewCount: 'many' },
    });
    const api = fakeApi([{ body: videosReply([odd]) }]);

    const { items, skipped } = await fetchVideos([videoId(1)], api.options);

    expect(skipped).toBe(0);
    expect(items[0]).toMatchObject({
      categoryId: null,
      defaultLanguage: null,
      defaultAudioLanguage: null,
      durationSeconds: null,
      views: null,
    });
  });

  test('keeps a channel whose figures are in a shape not expected, reading them as unknown', async () => {
    const odd = channelItem('A', {
      statistics: { viewCount: -5, subscriberCount: '12', hiddenSubscriberCount: 'no' },
      contentDetails: { relatedPlaylists: 'none' },
    });
    const api = fakeApi([{ body: channelsReply([odd]) }]);

    const { items } = await fetchChannels([channelId('A')], api.options);

    expect(items[0]).toMatchObject({
      totalViews: null,
      subscribers: 12,
      subscribersHidden: false,
      uploadsPlaylistId: null,
    });
  });

  test('reads a count too large to hold exactly as unknown, not as a rounded number', async () => {
    const huge = videoItem(1, 'A', { statistics: { viewCount: '9007199254740993' } });
    const api = fakeApi([{ body: videosReply([huge]) }]);

    const { items } = await fetchVideos([videoId(1)], api.options);

    expect(items[0]?.views).toBeNull();
  });
});

describe('small print of the requests', () => {
  test('does not send a page size with a read by id, where the API ignores it', async () => {
    const api = fakeApi([{ body: videosReply([]) }, { body: channelsReply([]) }]);

    await fetchVideos([videoId(1)], api.options);
    await fetchChannels([channelId('A')], api.options);

    expect(param(api.calls[0], 'maxResults')).toBeNull();
    expect(param(api.calls[1], 'maxResults')).toBeNull();
  });

  test('keeps the pages already read when a later page of a list is gone', async () => {
    const api = fakeApi([
      { body: playlistReply([1, 2], 'page-two') },
      { status: 404, body: PLAYLIST_NOT_FOUND },
    ]);

    const result = await fetchPlaylistVideoIds(uploadsId('A'), { ...api.options, maxPages: 5 });

    expect(result).toEqual({
      videoIds: [videoId(1), videoId(2)],
      notFound: false,
      complete: false,
      skipped: 0,
    });
  });

  test('tells being asked too fast apart from the daily allowance running out', async () => {
    const body = {
      error: { code: 403, message: 'Rate limit', errors: [{ reason: 'rateLimitExceeded' }] },
    };
    const api = fakeApi([{ status: 403, body }]);

    const attempt = rejected(fetchVideos([videoId(1)], api.options));

    await expect(attempt).rejects.toMatchObject({ quotaSpent: false, rateLimited: true });
    await expect(attempt).rejects.toThrow(/asked too fast/);
  });

  test('refuses to follow a reply that points to another address', async () => {
    let redirect: RequestInit['redirect'];
    const fetcher = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      redirect = init?.redirect;
      return new Response(JSON.stringify(videosReply([])));
    };

    await fetchVideos([videoId(1)], { ...fakeApi([]).options, fetch: fetcher });

    expect(redirect).toBe('error');
  });
});

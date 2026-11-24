import { describe, expect, test } from 'vitest';
import { API_MAX_SHORT_SECONDS, fetchApiChannel, isoSeconds } from '../src/sources/apiChannels';
import { InnertubeSource, type InnertubeClient } from '../src/sources/innertube';
import { RateLimiter } from '../src/sources/limiter';
import { mapSearchResults } from '../src/sources/searchResults';

const CHANNEL = `UC${'A'.repeat(22)}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const video = (id: string, duration: string, extra: Record<string, unknown> = {}) => ({
  id,
  snippet: { title: `Video ${id}`, publishedAt: '2026-11-01T10:00:00Z', liveBroadcastContent: 'none' },
  statistics: { viewCount: '12345' },
  contentDetails: { duration },
  ...extra,
});

function fakeApi() {
  const asked: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push(url.pathname.split('/').at(-1) ?? '');
    expect(url.searchParams.has('key')).toBe(false);
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    if (url.pathname.endsWith('/channels')) {
      return json({
        items: [
          {
            id: CHANNEL,
            snippet: { title: 'Rockets', customUrl: '@rockets' },
            statistics: { videoCount: '3', subscriberCount: '4200', hiddenSubscriberCount: false },
            contentDetails: { relatedPlaylists: { uploads: 'UUx' } },
          },
        ],
      });
    }
    if (url.pathname.endsWith('/playlistItems')) {
      return url.searchParams.get('pageToken') === null
        ? json({
            items: [{ contentDetails: { videoId: 'aaaaaaaaaa1' } }, { bad: true }],
            nextPageToken: 'p2',
          })
        : json({ items: [{ contentDetails: { videoId: 'aaaaaaaaaa2' } }, { contentDetails: { videoId: 'aaaaaaaaaa3' } }] });
    }
    return json({
      items: [
        video('aaaaaaaaaa1', 'PT12M5S'),
        video('aaaaaaaaaa2', 'PT45S'),
        video('aaaaaaaaaa3', 'PT1H', {
          snippet: { title: 'Live', publishedAt: '2026-11-01T10:00:00Z', liveBroadcastContent: 'live' },
        }),
      ],
    });
  }) as typeof fetch;
  return { asked, fetcher };
}

describe('a channel read through the official API', () => {
  test('reads its details, its uploads and their views, one unit a request', async () => {
    const { asked, fetcher } = fakeApi();
    let units = 0;
    const read = await fetchApiChannel(CHANNEL, 100, {
      apiKey: 'k',
      fetch: fetcher,
      onRequest: () => (units += 1),
    });
    expect(asked).toEqual(['channels', 'playlistItems', 'playlistItems', 'videos']);
    expect(units).toBe(4);
    expect(read.channel).toEqual({
      id: CHANNEL,
      title: 'Rockets',
      handle: '@rockets',
      subscribers: 4200,
      subscribersHidden: false,
      videoCount: 3,
    });
    // The 45-second upload may be a Short and the live one is not a video yet.
    expect(read.videos.map((v) => [v.id, v.views, v.durationSeconds])).toEqual([
      ['aaaaaaaaaa1', 12345, 725],
    ]);
    expect(read.videos[0]?.published?.raw).toBe('2026-11-01');
  });

  test('stops at the number of uploads asked for', async () => {
    const { asked, fetcher } = fakeApi();
    await fetchApiChannel(CHANNEL, 1, { apiKey: 'k', fetch: fetcher });
    expect(asked).toEqual(['channels', 'playlistItems', 'videos']);
  });

  test('refuses a bad id and a channel the API does not know', async () => {
    await expect(fetchApiChannel('nope', 10, { apiKey: 'k' })).rejects.toThrow();
    const empty = (async () => json({ items: [] })) as unknown as typeof fetch;
    await expect(fetchApiChannel(CHANNEL, 10, { apiKey: 'k', fetch: empty })).rejects.toThrow(
      /does not know/,
    );
  });

  test('reads ISO lengths', () => {
    expect(isoSeconds('PT1H2M3S')).toBe(3723);
    expect(isoSeconds('P1DT1S')).toBe(86_401);
    expect(isoSeconds('PT')).toBeNull();
    expect(isoSeconds('P')).toBeNull();
    expect(isoSeconds('12:00')).toBeNull();
    expect(API_MAX_SHORT_SECONDS).toBe(180);
  });
});

describe('a signed-out search results page', () => {
  test('gives each video once with its channel, sections opened out', () => {
    const found = mapSearchResults([
      { type: 'Video', video_id: 'aaaaaaaaaa1', author: { id: CHANNEL } },
      { type: 'ItemSection', contents: [{ type: 'Video', id: 'aaaaaaaaaa2', author: { id: CHANNEL } }] },
      { type: 'Video', video_id: 'aaaaaaaaaa1', author: { id: CHANNEL } },
      { type: 'Channel', id: CHANNEL },
      { type: 'Video', video_id: 'short', author: { id: CHANNEL } },
      { type: 'Video', video_id: 'aaaaaaaaaa3' },
      null,
    ]);
    expect(found).toEqual([
      { videoId: 'aaaaaaaaaa1', channelId: CHANNEL },
      { videoId: 'aaaaaaaaaa2', channelId: CHANNEL },
    ]);
    expect(mapSearchResults(undefined)).toEqual([]);
  });

  test('is one request through the limiter, for popular videos of the last month', async () => {
    const asked: unknown[] = [];
    const client = {
      search: async (query: string, filters: unknown) => {
        asked.push([query, filters]);
        return { results: [{ type: 'Video', video_id: 'aaaaaaaaaa1', author: { id: CHANNEL } }] };
      },
    } as unknown as InnertubeClient;
    const limiter = new RateLimiter({ concurrency: 1, minDelayMs: 0, maxDelayMs: 0, maxRetries: 0, baseBackoffMs: 0 });
    const source = new InnertubeSource(client, limiter, () => new Date());
    expect(await source.searchVideos(' rockets ')).toHaveLength(1);
    expect(asked).toEqual([
      ['rockets', { type: 'video', upload_date: 'month', prioritize: 'popularity' }],
    ]);
    await expect(source.searchVideos('')).rejects.toThrow();
    const none = new InnertubeSource({} as InnertubeClient, limiter, () => new Date());
    await expect(none.searchVideos('x')).rejects.toThrow(/cannot search/);
  });
});

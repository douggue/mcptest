import { describe, expect, test } from 'vitest';
import {
  InnertubeSource,
  type ChannelPage,
  type InnertubeClient,
  type VideosTab,
} from '../src/sources/innertube';
import { RateLimiter } from '../src/sources/limiter';
import channelFixture from './fixtures/channel.json';
import channelVideos from './fixtures/channel-videos.json';
import sidebar from './fixtures/sidebar.json';

const NOW = new Date('2026-11-20T12:00:00Z');
const CHANNEL_ID = 'UCHnyfMqiRRG1u-2MsSQLbXA';

const limiter = new RateLimiter({
  concurrency: 2,
  minDelayMs: 0,
  maxDelayMs: 0,
  maxRetries: 0,
  baseBackoffMs: 0,
  sleep: async () => {},
});

function pagedTab(pages: readonly (readonly unknown[])[], index = 0): VideosTab {
  return {
    videos: pages[index] ?? [],
    has_continuation: index < pages.length - 1,
    getContinuation: async () => pagedTab(pages, index + 1),
  };
}

function makeClient(
  overrides: Partial<InnertubeClient> = {},
): InnertubeClient & { urls: string[] } {
  const urls: string[] = [];
  const page: ChannelPage = {
    header: channelFixture.header,
    metadata: channelFixture.metadata,
    getVideos: async () => pagedTab([channelVideos.slice(0, 2), channelVideos.slice(2)]),
  };
  return {
    urls,
    resolveURL: async (url) => {
      urls.push(url);
      return { payload: { browseId: CHANNEL_ID } };
    },
    getChannel: async () => page,
    getInfo: async () => ({ watch_next_feed: [...sidebar, { type: 'Unknown' }] }),
    getBasicInfo: async () => ({}),
    ...overrides,
  };
}

const makeSource = (client: InnertubeClient) => new InnertubeSource(client, limiter, () => NOW);

describe('InnertubeSource', () => {
  test('resolves a handle through a youtube.com URL it builds itself', async () => {
    const client = makeClient();

    await expect(makeSource(client).resolveChannelId('veritasium')).resolves.toBe(CHANNEL_ID);
    expect(client.urls).toEqual(['https://www.youtube.com/@veritasium']);
  });

  test('fails clearly when a handle does not resolve to a channel', async () => {
    const client = makeClient({ resolveURL: async () => ({ payload: {} }) });

    await expect(makeSource(client).resolveChannelId('nobody-here')).rejects.toThrow(/nobody-here/);
  });

  test('follows continuations to collect a channel’s videos', async () => {
    const snapshot = await makeSource(makeClient()).fetchChannel(CHANNEL_ID, 100);

    expect(snapshot.channel.title).toBe('Veritasium');
    expect(snapshot.videos.map((v) => v.id)).toEqual(['uXuQF_PPg5U', 'KfODG5REyss', 'eyZEqSPeMwg']);
  });

  test('stops paging once it has the requested number of videos', async () => {
    const snapshot = await makeSource(makeClient()).fetchChannel(CHANNEL_ID, 2);

    expect(snapshot.videos).toHaveLength(2);
  });

  test('reads only the channel page when no videos are asked for', async () => {
    let videoRequests = 0;
    const client = makeClient({
      getChannel: async () => ({
        header: channelFixture.header,
        metadata: channelFixture.metadata,
        getVideos: async () => {
          videoRequests += 1;
          return pagedTab([channelVideos]);
        },
      }),
    });

    const snapshot = await makeSource(client).fetchChannel(CHANNEL_ID, 0);

    expect(videoRequests).toBe(0);
    expect(snapshot.videos).toEqual([]);
    expect(snapshot.brand?.avatar.length).toBeGreaterThan(0);
  });

  test('fails clearly when the channel page cannot be read', async () => {
    const client = makeClient({
      getChannel: async () => ({
        header: {},
        metadata: {},
        getVideos: async () => pagedTab([[]]),
      }),
    });

    await expect(makeSource(client).fetchChannel(CHANNEL_ID, 10)).rejects.toThrow(/channel/i);
  });

  test('maps the sidebar and drops items it cannot read', async () => {
    const items = await makeSource(makeClient()).getSidebar('uXuQF_PPg5U');

    expect(items.map((item) => item.channelName)).toEqual([
      'Cleo Abram',
      'Mrwhosetheboss',
      'Veritasium',
    ]);
  });

  test('returns an empty sidebar when the page has no recommendations', async () => {
    const client = makeClient({ getInfo: async () => ({ watch_next_feed: null }) });

    await expect(makeSource(client).getSidebar('uXuQF_PPg5U')).resolves.toEqual([]);
  });
});

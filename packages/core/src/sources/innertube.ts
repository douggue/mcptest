import { Innertube } from 'youtubei.js';
import type { RateLimiter } from './limiter';
import { mapChannel, mapChannelVideo, mapSidebarItem } from './mappers';
import { CHANNEL_ID_PATTERN, HANDLE_PATTERN, VIDEO_ID_PATTERN } from './parse';
import type { ChannelSnapshot, SidebarItem, VideoItem, YouTubeSource } from './types';

/** The slice of the YouTube client this source uses, so tests can fake it. */
export interface VideosTab {
  readonly videos: readonly unknown[];
  readonly has_continuation: boolean;
  getContinuation(): Promise<VideosTab>;
}

export interface ChannelPage {
  readonly header: unknown;
  readonly metadata: unknown;
  getVideos(): Promise<VideosTab>;
}

export interface InnertubeClient {
  resolveURL(url: string): Promise<unknown>;
  getChannel(channelId: string): Promise<ChannelPage>;
  getInfo(videoId: string): Promise<{ readonly watch_next_feed?: readonly unknown[] | null }>;
}

export interface InnertubeSourceOptions {
  readonly limiter: RateLimiter;
  readonly region: string;
  readonly now?: () => Date;
}

/** The parsers read English text ("2w ago", "subscribers"), so listings are always requested in English. */
const LISTING_LANGUAGE = 'en';
/** Upper bound on continuation requests for one channel, whatever the pages contain. */
const MAX_VIDEO_PAGES = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads public channel and watch pages through YouTube's web API, signed out.
 * See docs/CRAWL.md for what this returns and the risks of relying on it.
 */
export class InnertubeSource implements YouTubeSource {
  constructor(
    private readonly client: InnertubeClient,
    private readonly limiter: RateLimiter,
    private readonly now: () => Date,
  ) {}

  static async create(options: InnertubeSourceOptions): Promise<InnertubeSource> {
    const client = await Innertube.create({
      retrieve_player: false,
      lang: LISTING_LANGUAGE,
      location: options.region,
    });
    return new InnertubeSource(
      client as unknown as InnertubeClient,
      options.limiter,
      options.now ?? (() => new Date()),
    );
  }

  async resolveChannelId(handle: string): Promise<string> {
    if (!HANDLE_PATTERN.test(handle)) {
      throw new Error(`Not a valid YouTube channel handle: "${handle.slice(0, 40)}"`);
    }
    const url = `https://www.youtube.com/@${handle}`;
    const endpoint = await this.limiter.run(() => this.client.resolveURL(url));
    const payload = isRecord(endpoint) ? endpoint['payload'] : undefined;
    const id = isRecord(payload) ? payload['browseId'] : undefined;
    if (typeof id !== 'string' || !CHANNEL_ID_PATTERN.test(id)) {
      throw new Error(`No YouTube channel found for handle "@${handle}"`);
    }
    return id;
  }

  async fetchChannel(channelId: string, maxVideos: number): Promise<ChannelSnapshot> {
    if (!CHANNEL_ID_PATTERN.test(channelId)) {
      throw new Error(`Not a valid YouTube channel id: "${channelId.slice(0, 40)}"`);
    }
    const page = await this.limiter.run(() => this.client.getChannel(channelId));
    const channel = mapChannel(page.header, page.metadata);
    if (!channel) throw new Error(`Could not read the channel page for ${channelId}`);
    const videos = await this.collectVideos(page, channel.id, maxVideos);
    return { channel, videos };
  }

  async getSidebar(videoId: string): Promise<readonly SidebarItem[]> {
    if (!VIDEO_ID_PATTERN.test(videoId)) {
      throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
    }
    const info = await this.limiter.run(() => this.client.getInfo(videoId));
    const now = this.now();
    return (info.watch_next_feed ?? [])
      .map((item) => mapSidebarItem(item, now))
      .filter((item): item is SidebarItem => item !== null);
  }

  private async collectVideos(
    page: ChannelPage,
    channelId: string,
    maxVideos: number,
  ): Promise<readonly VideoItem[]> {
    const now = this.now();
    const mapPage = (tab: VideosTab): readonly VideoItem[] =>
      tab.videos
        .map((item) => mapChannelVideo(item, channelId, now))
        .filter((video): video is VideoItem => video !== null);

    let tab = await this.limiter.run(() => page.getVideos());
    let collected = mapPage(tab);
    let pagesRead = 1;
    while (
      collected.length < maxVideos &&
      tab.has_continuation &&
      tab.videos.length > 0 &&
      pagesRead < MAX_VIDEO_PAGES
    ) {
      const current = tab;
      tab = await this.limiter.run(() => current.getContinuation());
      collected = [...collected, ...mapPage(tab)];
      pagesRead += 1;
    }
    return collected.slice(0, maxVideos);
  }
}

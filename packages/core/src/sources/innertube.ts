import { Innertube, Log, Parser } from 'youtubei.js';
import { mapChannelBrand } from './brandMapper';
import { readCapped } from './images';
import type { RateLimiter } from './limiter';
import { at, mapChannel, mapChannelVideo, mapSidebarItem } from './mappers';
import { CHANNEL_ID_PATTERN, HANDLE_PATTERN, VIDEO_ID_PATTERN } from './parse';
import type {
  ChannelSnapshot,
  SidebarItem,
  VideoItem,
  VideoPage,
  VideoPageOptions,
  VideoTranscript,
  YouTubeSource,
} from './types';
import {
  mapStoryboard,
  mapTranscriptPanel,
  mapVideoDetails,
  parseTimedText,
  pickCaptionTrack,
  type CaptionTrack,
} from './videoPage';

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

/** A watch page as the library returns it: the sidebar, the video's facts, and its transcript call. */
export interface WatchPage {
  readonly watch_next_feed?: readonly unknown[] | null;
  readonly basic_info?: unknown;
  /** The library's documented way to read a video's transcript; one more request. */
  getTranscript?(): Promise<unknown>;
}

export interface InnertubeClient {
  resolveURL(url: string): Promise<unknown>;
  getChannel(channelId: string): Promise<ChannelPage>;
  getInfo(videoId: string): Promise<WatchPage>;
  /** The player's answer for one video, asked as the named client; one request. */
  getBasicInfo(videoId: string, options: { readonly client: string }): Promise<unknown>;
}

/** The part of `fetch` used to read a caption track, so tests can stand in for the network. */
export type FetchText = (
  url: string,
  init: { readonly signal: AbortSignal; readonly redirect: 'error' },
) => Promise<Response>;

export interface InnertubeSourceOptions {
  readonly limiter: RateLimiter;
  readonly region: string;
  readonly now?: () => Date;
}

/** The parsers read English text ("2w ago", "subscribers"), so listings are always requested in English. */
const LISTING_LANGUAGE = 'en';
/** Upper bound on continuation requests for one channel, whatever the pages contain. */
const MAX_VIDEO_PAGES = 10;
/**
 * A sidebar this long with no readable video means the page format changed. A
 * shorter one can honestly hold only playlists or mixes.
 */
const MIN_ITEMS_FOR_ALARM = 5;
/**
 * The client the player is asked as for a video's own page. Asked as the web
 * client, signed out, the player answers "The page needs to be reloaded" and
 * carries neither a storyboard nor caption tracks, and the library's
 * transcript call is refused with status 400 (both seen live, November 2026).
 * Asked as this client it answers in full, in one request.
 */
const PLAYER_CLIENT = 'ANDROID_VR';
const PLAYABLE = 'OK';
const CAPTION_TIMEOUT_MS = 20_000;
/**
 * The captions of a half-hour video, with a time for every word, come to
 * about 350 KB (seen live). This allows a video of several hours and no more.
 */
const MAX_CAPTION_BYTES = 5_000_000;
/** What the library's transcript call says when a video simply has none. */
const NO_TRANSCRIPT = /no transcript|transcript panel not found|engagement panels not found/i;
const MAX_REASON_LENGTH = 160;

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
    private readonly fetchText: FetchText = fetch,
  ) {}

  static async create(options: InnertubeSourceOptions): Promise<InnertubeSource> {
    // The library logs every list-item type it has not seen before. The mappers
    // already skip what they cannot read, so those reports are noise here.
    Parser.setParserErrorHandler(() => {});
    Log.setLevel(Log.Level.ERROR);
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
    return { channel, videos, brand: mapChannelBrand(page.header, page.metadata) };
  }

  async fetchVideoPage(videoId: string, options: VideoPageOptions = {}): Promise<VideoPage> {
    if (!VIDEO_ID_PATTERN.test(videoId)) {
      throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
    }
    const player = await this.limiter.run(() =>
      this.client.getBasicInfo(videoId, { client: PLAYER_CLIENT }),
    );
    const page = {
      videoId,
      details: mapVideoDetails(at(player, 'basic_info')),
      storyboard: mapStoryboard(at(player, 'storyboards')),
    };
    if (at(player, 'playability_status', 'status') !== PLAYABLE) {
      return this.fromWatchPage(page, options);
    }
    if (!options.transcript) return page;
    // The player answered in full, so a page without caption tracks has none.
    const track = pickCaptionTrack(at(player, 'captions'));
    return { ...page, transcript: track ? await this.readCaptions(videoId, track) : null };
  }

  /**
   * The other route, for when the player will not answer: the watch page the
   * crawl already reads, and the library's own transcript call on it.
   */
  private async fromWatchPage(page: VideoPage, options: VideoPageOptions): Promise<VideoPage> {
    const watch = await this.limiter.run(() => this.client.getInfo(page.videoId));
    const filled = { ...page, details: page.details ?? mapVideoDetails(watch.basic_info) };
    if (!options.transcript) return filled;
    return { ...filled, transcript: await this.readTranscriptPanel(page.videoId, watch) };
  }

  private async readTranscriptPanel(
    videoId: string,
    watch: WatchPage,
  ): Promise<VideoTranscript | null> {
    const read = watch.getTranscript;
    if (typeof read !== 'function') return null;
    try {
      return mapTranscriptPanel(await this.limiter.run(() => read.call(watch)));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (NO_TRANSCRIPT.test(reason)) return null;
      throw new Error(
        `The captions of video ${videoId} could not be read: ${reason.slice(0, MAX_REASON_LENGTH)}`,
        { cause: error },
      );
    }
  }

  /** Reads one caption track. Its address was checked when the track was picked. */
  private async readCaptions(
    videoId: string,
    track: CaptionTrack,
  ): Promise<VideoTranscript | null> {
    const response = await this.limiter.run(async () => {
      const answer = await this.fetchText(track.url, {
        signal: AbortSignal.timeout(CAPTION_TIMEOUT_MS),
        redirect: 'error',
      });
      if (answer.ok) return answer;
      // Carries the status so that the limiter retries a refusal that may pass.
      throw Object.assign(
        new Error(
          `YouTube would not give the captions of video ${videoId} (status ${answer.status})`,
        ),
        { status: answer.status },
      );
    });
    const bytes = await readCapped(response, MAX_CAPTION_BYTES);
    if (bytes === null) throw new Error(`The captions of video ${videoId} are too large to read`);
    let body: unknown;
    try {
      body = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      throw new Error(`The captions of video ${videoId} could not be read`);
    }
    const segments = parseTimedText(body);
    if (segments.length === 0) return null;
    return { language: track.language, autoGenerated: track.autoGenerated, segments };
  }

  async getSidebar(videoId: string): Promise<readonly SidebarItem[]> {
    if (!VIDEO_ID_PATTERN.test(videoId)) {
      throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
    }
    const info = await this.limiter.run(() => this.client.getInfo(videoId));
    const now = this.now();
    const feed = info.watch_next_feed ?? [];
    const items = feed
      .map((item) => mapSidebarItem(item, now))
      .filter((item): item is SidebarItem => item !== null);
    if (feed.length >= MIN_ITEMS_FOR_ALARM && items.length === 0) {
      throw new Error(
        `YouTube listed ${feed.length} recommendations for ${videoId} but none could be read. Its page format may have changed.`,
      );
    }
    return items;
  }

  private async collectVideos(
    page: ChannelPage,
    channelId: string,
    maxVideos: number,
  ): Promise<readonly VideoItem[]> {
    const now = this.now();
    const mapPage = (tab: VideosTab): readonly VideoItem[] => {
      const mapped = tab.videos
        .map((item) => mapChannelVideo(item, channelId, now))
        .filter((video): video is VideoItem => video !== null);
      if (tab.videos.length > 0 && mapped.length === 0) {
        throw new Error(
          `YouTube listed ${tab.videos.length} videos for ${channelId} but none could be read. Its page format may have changed.`,
        );
      }
      return mapped;
    };

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

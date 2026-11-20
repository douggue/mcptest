/**
 * The official YouTube Data API reader: a search for recent videos on a
 * subject, the facts of videos and channels, and the videos in a list.
 *
 * It needs the owner's own API key. Every request is counted against the
 * key's daily allowance through `options.spend` before it is sent: a search
 * costs 100 units, everything else 1 unit per request of up to fifty.
 */
import { z } from 'zod';
import { YouTubeApiError, getPage, type Cost, type DataApiOptions } from './client';
import { parseIsoDuration } from './duration';
import { CHANNEL_ID_PATTERN, PLAYLIST_ID_PATTERN, VIDEO_ID_PATTERN } from './ids';

export { REQUEST_TIMEOUT_MS, YouTubeApiError } from './client';
export type { DataApiOptions, Spend } from './client';

/** The API's own limit on ids per request, and on results per page. */
const MAX_PER_REQUEST = 50;
/** What the API charges for one search, whatever it returns. */
export const SEARCH_COST_UNITS = 100;
const SEARCH_COST: Cost = { kind: 'search', units: SEARCH_COST_UNITS };
const VIDEOS_COST: Cost = { kind: 'reading', units: 1 };
const CHANNELS_COST: Cost = { kind: 'channel', units: 1 };
const PLAYLIST_COST: Cost = { kind: 'channel', units: 1 };
const MAX_QUERY_LENGTH = 200;
const MAX_TEXT_LENGTH = 300;
const MAX_SHOWN_ID_LENGTH = 40;
const NOT_FOUND = 404;
const REGION_PATTERN = /^[A-Z]{2}$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

const count = z
  .string()
  .regex(/^\d+$/)
  .transform((text) => Number(text));

/** A timestamp as the API writes it, read as a date; unreadable ones fail validation. */
const timestamp = z
  .string()
  .transform((text) => new Date(text))
  .refine((date) => !Number.isNaN(date.getTime()));

const shortText = z.string().transform((text) => text.slice(0, MAX_TEXT_LENGTH));

/** Reads each raw item against the schema, leaving out the ones that do not fit it. */
const readable = <T>(items: readonly unknown[], schema: z.ZodType<T>): readonly T[] =>
  items.flatMap((raw) => {
    const parsed = schema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });

const batchesOf = (ids: readonly string[]): readonly (readonly string[])[] =>
  Array.from({ length: Math.ceil(ids.length / MAX_PER_REQUEST) }, (_, index) =>
    ids.slice(index * MAX_PER_REQUEST, (index + 1) * MAX_PER_REQUEST),
  );

function requireIds(ids: readonly string[], pattern: RegExp, what: string): readonly string[] {
  const invalid = ids.find((id) => !pattern.test(id));
  if (invalid !== undefined) {
    throw new Error(`Not a valid YouTube ${what} id: "${invalid.slice(0, MAX_SHOWN_ID_LENGTH)}"`);
  }
  return [...new Set(ids)];
}

// --- search.list ---------------------------------------------------------

export interface SearchHit {
  readonly videoId: string;
  readonly channelId: string;
  readonly channelTitle: string;
  /** As the search returns it, which may contain HTML character codes such as &#39;. */
  readonly title: string;
  readonly publishedAt: Date;
}

export interface SearchOptions extends DataApiOptions {
  /** Only videos published after this moment are returned. */
  readonly publishedAfter: Date;
  /** Two-letter country whose viewers the results are for. */
  readonly regionCode: string;
  /** The language results lean towards, such as "en"; the API treats it as a preference. */
  readonly relevanceLanguage?: string;
  /**
   * Only videos the API calls short: under four minutes. That is wider than a
   * Short (three minutes at most, and upright), so it narrows the search but
   * does not decide what is a Short.
   */
  readonly shortOnly: boolean;
}

const hitSchema = z
  .object({
    id: z.object({ videoId: z.string().regex(VIDEO_ID_PATTERN) }),
    snippet: z.object({
      channelId: z.string().regex(CHANNEL_ID_PATTERN),
      channelTitle: shortText,
      title: shortText,
      publishedAt: timestamp,
    }),
  })
  .transform(({ id, snippet }): SearchHit => ({
    videoId: id.videoId,
    channelId: snippet.channelId,
    channelTitle: snippet.channelTitle,
    title: snippet.title,
    publishedAt: snippet.publishedAt,
  }));

function searchParams(text: string, options: SearchOptions): URLSearchParams {
  if (text === '' || text.length > MAX_QUERY_LENGTH) {
    throw new Error(`Give a search of 1 to ${MAX_QUERY_LENGTH} characters`);
  }
  if (!REGION_PATTERN.test(options.regionCode)) {
    throw new Error('Give the country as a two-letter code such as US');
  }
  const language = options.relevanceLanguage;
  if (language !== undefined && !LANGUAGE_PATTERN.test(language)) {
    throw new Error('Give the language as a code such as en');
  }
  if (Number.isNaN(options.publishedAfter.getTime())) {
    throw new Error('Give a readable date to search from');
  }
  return new URLSearchParams({
    part: 'snippet',
    type: 'video',
    q: text,
    order: 'viewCount',
    publishedAfter: options.publishedAfter.toISOString(),
    regionCode: options.regionCode,
    ...(language === undefined ? {} : { relevanceLanguage: language }),
    ...(options.shortOnly ? { videoDuration: 'short' } : {}),
    maxResults: String(MAX_PER_REQUEST),
  });
}

/**
 * The most-viewed videos on a subject published since a date, as seen from one
 * country: one page of up to fifty, for 100 units of the key's daily
 * allowance. Results that are not readable videos are left out.
 */
export async function searchRecentVideos(
  query: string,
  options: SearchOptions,
): Promise<readonly SearchHit[]> {
  const params = searchParams(query.trim(), options);
  const page = await getPage('search', params, SEARCH_COST, options);
  return readable(page.items, hitSchema);
}

// --- videos.list ---------------------------------------------------------

export interface VideoFacts {
  readonly id: string;
  readonly channelId: string;
  readonly title: string;
  /** The exact moment of publication. */
  readonly publishedAt: Date;
  /** Null for a live broadcast, which has no length yet, and for a length that cannot be read. */
  readonly durationSeconds: number | null;
  /** YouTube's numbered category, such as "26"; null when the reply gives none. */
  readonly categoryId: string | null;
  /** The language of the title and description, when the uploader set one. */
  readonly defaultLanguage: string | null;
  /** The spoken language, when the uploader set one. */
  readonly defaultAudioLanguage: string | null;
  /** Null when the uploader hides the view count. */
  readonly views: number | null;
}

const code = z.string().min(1).max(20).optional();

/** A live broadcast is written as a length of nothing; that is "not known", not "zero seconds". */
const lengthOf = (text: string | undefined): number | null => {
  const seconds = text === undefined ? null : parseIsoDuration(text);
  return seconds === null || seconds === 0 ? null : seconds;
};

const videoSchema = z
  .object({
    id: z.string().regex(VIDEO_ID_PATTERN),
    snippet: z.object({
      channelId: z.string().regex(CHANNEL_ID_PATTERN),
      title: shortText,
      publishedAt: timestamp,
      categoryId: code,
      defaultLanguage: code,
      defaultAudioLanguage: code,
    }),
    contentDetails: z.object({ duration: z.string().optional() }).optional(),
    statistics: z.object({ viewCount: count.optional() }).optional(),
  })
  .transform(({ id, snippet, contentDetails, statistics }): VideoFacts => ({
    id,
    channelId: snippet.channelId,
    title: snippet.title,
    publishedAt: snippet.publishedAt,
    durationSeconds: lengthOf(contentDetails?.duration),
    categoryId: snippet.categoryId ?? null,
    defaultLanguage: snippet.defaultLanguage ?? null,
    defaultAudioLanguage: snippet.defaultAudioLanguage ?? null,
    views: statistics?.viewCount ?? null,
  }));

/**
 * Reads the facts of the given videos, fifty per request at 1 unit each. A
 * video the API does not know (deleted, private), or an entry that cannot be
 * read, is simply absent from the result; a refused request fails the whole call.
 */
export async function fetchVideos(
  videoIds: readonly string[],
  options: DataApiOptions,
): Promise<readonly VideoFacts[]> {
  const ids = requireIds(videoIds, VIDEO_ID_PATTERN, 'video');
  let videos: readonly VideoFacts[] = [];
  for (const batch of batchesOf(ids)) {
    const query = new URLSearchParams({
      part: 'snippet,contentDetails,statistics',
      id: batch.join(','),
      maxResults: String(MAX_PER_REQUEST),
    });
    const page = await getPage('videos', query, VIDEOS_COST, options);
    videos = [...videos, ...readable(page.items, videoSchema)];
  }
  return videos;
}

// --- channels.list -------------------------------------------------------

export interface ChannelFacts {
  readonly id: string;
  readonly title: string;
  /** When the channel account was created, which can be long before its first upload. */
  readonly createdAt: Date;
  /** Two-letter country the channel's owner set, or null when they set none. */
  readonly country: string | null;
  readonly totalViews: number | null;
  readonly videoCount: number | null;
  /** Rounded by the API to three figures; null when hidden. */
  readonly subscribers: number | null;
  readonly subscribersHidden: boolean;
  /** The list holding every upload of the channel, for `fetchPlaylistVideoIds`. */
  readonly uploadsPlaylistId: string | null;
}

const channelSchema = z
  .object({
    id: z.string().regex(CHANNEL_ID_PATTERN),
    snippet: z.object({
      title: shortText,
      publishedAt: timestamp,
      country: z.string().max(10).optional(),
    }),
    statistics: z
      .object({
        viewCount: count.optional(),
        videoCount: count.optional(),
        subscriberCount: count.optional(),
        hiddenSubscriberCount: z.boolean().optional(),
      })
      .optional(),
    contentDetails: z
      .object({
        relatedPlaylists: z
          .object({ uploads: z.string().regex(PLAYLIST_ID_PATTERN).optional().catch(undefined) })
          .optional(),
      })
      .optional(),
  })
  .transform(({ id, snippet, statistics, contentDetails }): ChannelFacts => {
    const subscribersHidden = statistics?.hiddenSubscriberCount ?? false;
    return {
      id,
      title: snippet.title,
      createdAt: snippet.publishedAt,
      country: snippet.country ?? null,
      totalViews: statistics?.viewCount ?? null,
      videoCount: statistics?.videoCount ?? null,
      subscribers: subscribersHidden ? null : (statistics?.subscriberCount ?? null),
      subscribersHidden,
      uploadsPlaylistId: contentDetails?.relatedPlaylists?.uploads ?? null,
    };
  });

/**
 * Reads the facts of the given channels, fifty per request at 1 unit each. A
 * channel the API does not know, or an entry that cannot be read, is simply
 * absent from the result; a refused request fails the whole call.
 */
export async function fetchChannels(
  channelIds: readonly string[],
  options: DataApiOptions,
): Promise<readonly ChannelFacts[]> {
  const ids = requireIds(channelIds, CHANNEL_ID_PATTERN, 'channel');
  let channels: readonly ChannelFacts[] = [];
  for (const batch of batchesOf(ids)) {
    const query = new URLSearchParams({
      part: 'snippet,statistics,contentDetails',
      id: batch.join(','),
      maxResults: String(MAX_PER_REQUEST),
    });
    const page = await getPage('channels', query, CHANNELS_COST, options);
    channels = [...channels, ...readable(page.items, channelSchema)];
  }
  return channels;
}

// --- playlistItems.list --------------------------------------------------

export interface PlaylistOptions extends DataApiOptions {
  /** The most pages (of fifty videos, 1 unit each) to read before stopping. */
  readonly maxPages: number;
}

export interface PlaylistVideoIds {
  /** In the list's own order, which for an uploads list is newest first. */
  readonly videoIds: readonly string[];
  /** True when the API knows no such list. Not a failure: some lists exist only for some channels. */
  readonly notFound: boolean;
  /** False when the page limit was reached and the list goes on. */
  readonly complete: boolean;
}

const playlistItemSchema = z
  .object({ contentDetails: z.object({ videoId: z.string().regex(VIDEO_ID_PATTERN) }) })
  .transform((item) => item.contentDetails.videoId);

function playlistQuery(playlistId: string, pageToken: string | null): URLSearchParams {
  return new URLSearchParams({
    part: 'contentDetails',
    playlistId,
    maxResults: String(MAX_PER_REQUEST),
    ...(pageToken === null ? {} : { pageToken }),
  });
}

/**
 * The ids of the videos in a list, page by page up to `maxPages`, at 1 unit a
 * page. A list the API does not know (a 404) gives an empty result marked
 * `notFound` instead of failing; any other refusal fails the call.
 */
export async function fetchPlaylistVideoIds(
  playlistId: string,
  options: PlaylistOptions,
): Promise<PlaylistVideoIds> {
  if (!PLAYLIST_ID_PATTERN.test(playlistId)) throw new Error('Not a valid YouTube list id');
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1) {
    throw new Error('Give a whole number of pages, at least 1');
  }
  let videoIds: readonly string[] = [];
  let pageToken: string | null = null;
  for (let read = 0; read < options.maxPages; read += 1) {
    try {
      const page = await getPage(
        'playlistItems',
        playlistQuery(playlistId, pageToken),
        PLAYLIST_COST,
        options,
      );
      videoIds = [...videoIds, ...readable(page.items, playlistItemSchema)];
      pageToken = page.nextPageToken;
    } catch (error) {
      if (error instanceof YouTubeApiError && error.status === NOT_FOUND) {
        return { videoIds: [], notFound: true, complete: true };
      }
      throw error;
    }
    if (pageToken === null) return { videoIds, notFound: false, complete: true };
  }
  return { videoIds, notFound: false, complete: false };
}

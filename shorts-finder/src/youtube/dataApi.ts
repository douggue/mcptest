/**
 * The official YouTube Data API reader: a search for recent videos on a
 * subject, the facts of videos and channels, and the videos in a list.
 *
 * It needs the owner's own API key. Every request is counted against the
 * key's daily allowance through `options.spend` before it is sent: a search
 * costs 100 units, everything else 1 unit per request of up to fifty.
 */
import { z } from 'zod';
import { YouTubeApiError, getPage, type Cost, type DataApiOptions, type Page } from './client';
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

/** A count as the API writes it: digits in text. One too large to hold exactly is refused. */
const count = z
  .string()
  .regex(/^\d+$/)
  .transform((text) => Number(text))
  .refine((value) => Number.isSafeInteger(value));

/** A timestamp as the API writes it, read as a date; unreadable ones fail validation. */
const timestamp = z
  .string()
  .transform((text) => new Date(text))
  .refine((date) => !Number.isNaN(date.getTime()));

const shortText = z.string().transform((text) => text.slice(0, MAX_TEXT_LENGTH));

interface Readable<T> {
  readonly items: readonly T[];
  /** How many entries did not fit the schema and were left out. */
  readonly skipped: number;
}

/** Reads each raw item against the schema, leaving out and counting the ones that do not fit it. */
function readable<T>(raw: readonly unknown[], schema: z.ZodType<T>): Readable<T> {
  const items = raw.flatMap((entry) => {
    const parsed = schema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  return { items, skipped: raw.length - items.length };
}

/**
 * What a read of many ids gave. The ids are asked for fifty at a time, and a
 * request that fails does not lose the ones before it: `items` holds what was
 * read, `failedIds` what was not asked for or not answered, `error` why.
 */
export interface ListResult<T> {
  readonly items: readonly T[];
  /** Entries the API sent that could not be read. Not the same as ids it left out. */
  readonly skipped: number;
  /** The ids of the request that failed and of every request after it. */
  readonly failedIds: readonly string[];
  /** Null when every request was answered. */
  readonly error: Error | null;
}

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/** Asks for the ids fifty at a time, keeping what was read when a request fails. */
async function readInBatches<T>(
  ids: readonly string[],
  schema: z.ZodType<T>,
  ask: (batch: readonly string[]) => Promise<Page>,
): Promise<ListResult<T>> {
  const batches = batchesOf(ids);
  let result: ListResult<T> = { items: [], skipped: 0, failedIds: [], error: null };
  for (const [index, batch] of batches.entries()) {
    try {
      const page = readable((await ask(batch)).items, schema);
      result = {
        ...result,
        items: [...result.items, ...page.items],
        skipped: result.skipped + page.skipped,
      };
    } catch (error) {
      return { ...result, failedIds: batches.slice(index).flat(), error: asError(error) };
    }
  }
  return result;
}

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

export interface SearchResult {
  readonly hits: readonly SearchHit[];
  /** Results the API sent that were not readable videos. */
  readonly skipped: number;
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
 * allowance. Results that are not readable videos are left out and counted.
 */
export async function searchRecentVideos(
  query: string,
  options: SearchOptions,
): Promise<SearchResult> {
  const params = searchParams(query.trim(), options);
  const page = await getPage('search', params, SEARCH_COST, options);
  const { items, skipped } = readable(page.items, hitSchema);
  return { hits: items, skipped };
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

/** A field the uploader may leave unset; one in a shape not expected reads as unset. */
const code = z.string().min(1).max(20).optional().catch(undefined);

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
    contentDetails: z
      .object({ duration: z.string().optional().catch(undefined) })
      .optional()
      .catch(undefined),
    statistics: z
      .object({ viewCount: count.optional().catch(undefined) })
      .optional()
      .catch(undefined),
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
 * video the API does not know (deleted, private) is simply absent from the
 * result; an entry that cannot be read is absent and counted. A request that
 * fails ends the read and is reported in the result, with what was read before it.
 */
export async function fetchVideos(
  videoIds: readonly string[],
  options: DataApiOptions,
): Promise<ListResult<VideoFacts>> {
  const ids = requireIds(videoIds, VIDEO_ID_PATTERN, 'video');
  return readInBatches(ids, videoSchema, (batch) => {
    const query = new URLSearchParams({
      part: 'snippet,contentDetails,statistics',
      id: batch.join(','),
    });
    return getPage('videos', query, VIDEOS_COST, options);
  });
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
      country: z.string().max(10).optional().catch(undefined),
    }),
    statistics: z
      .object({
        viewCount: count.optional().catch(undefined),
        videoCount: count.optional().catch(undefined),
        subscriberCount: count.optional().catch(undefined),
        hiddenSubscriberCount: z.boolean().optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    contentDetails: z
      .object({
        relatedPlaylists: z
          .object({ uploads: z.string().regex(PLAYLIST_ID_PATTERN).optional().catch(undefined) })
          .optional()
          .catch(undefined),
      })
      .optional()
      .catch(undefined),
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
 * channel the API does not know is simply absent from the result; an entry
 * that cannot be read is absent and counted. A request that fails ends the
 * read and is reported in the result, with what was read before it.
 */
export async function fetchChannels(
  channelIds: readonly string[],
  options: DataApiOptions,
): Promise<ListResult<ChannelFacts>> {
  const ids = requireIds(channelIds, CHANNEL_ID_PATTERN, 'channel');
  return readInBatches(ids, channelSchema, (batch) => {
    const query = new URLSearchParams({
      part: 'snippet,statistics,contentDetails',
      id: batch.join(','),
    });
    return getPage('channels', query, CHANNELS_COST, options);
  });
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
  /** False when the page limit was reached, or a later page was gone, and the list goes on. */
  readonly complete: boolean;
  /** Entries the API sent that held no readable video id. */
  readonly skipped: number;
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
 * page. A list the API does not know (a 404 on its first page) gives an empty
 * result marked `notFound` instead of failing. A 404 on a later page keeps the
 * pages already read and marks the result incomplete. Any other refusal fails the call.
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
  let skipped = 0;
  let pageToken: string | null = null;
  for (let read = 0; read < options.maxPages; read += 1) {
    try {
      const query = playlistQuery(playlistId, pageToken);
      const page = await getPage('playlistItems', query, PLAYLIST_COST, options);
      const ids = readable(page.items, playlistItemSchema);
      videoIds = [...videoIds, ...ids.items];
      skipped += ids.skipped;
      pageToken = page.nextPageToken;
    } catch (error) {
      if (!(error instanceof YouTubeApiError) || error.status !== NOT_FOUND) throw error;
      // Only a list unknown from its first page is "not found"; later, the list changed under the read.
      return { videoIds, notFound: read === 0, complete: read === 0, skipped };
    }
    if (pageToken === null) return { videoIds, notFound: false, complete: true, skipped };
  }
  return { videoIds, notFound: false, complete: false, skipped };
}

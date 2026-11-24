/**
 * A channel and its newest uploads read through the official Data API, in the
 * shape the page reading gives, so the usual ingest stores them. Used by the
 * outlier bank's "Find more outliers" when the owner has set a key.
 *
 * Per channel: its details (fifty channels a request, asked one at a time
 * here), up to two pages of its uploads list and up to two of those videos'
 * views and lengths; one unit each. The API cannot tell a Short from a long
 * video, and the store holds the long-form Videos tab, so uploads of three
 * minutes or less, and live or upcoming ones, are left out.
 */
import { z } from 'zod';
import { apiFetcher, apiGet, requireKey, type DataApiOptions } from './dataApi';
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from './parse';
import type { ChannelSnapshot, VideoItem } from './types';

/** Uploads at or under this many seconds may be Shorts, which the API does not mark. */
export const API_MAX_SHORT_SECONDS = 180;
const PAGE_SIZE = 50;
const MAX_TITLE = 300;

const count = z
  .string()
  .regex(/^\d+$/)
  .transform((text) => Number(text));

const channelSchema = z.object({
  id: z.string().regex(CHANNEL_ID_PATTERN),
  snippet: z.object({ title: z.string(), customUrl: z.string().optional() }),
  statistics: z
    .object({
      videoCount: count.optional(),
      subscriberCount: count.optional(),
      hiddenSubscriberCount: z.boolean().optional(),
    })
    .optional(),
  contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string().min(2) }) }),
});

const listSchema = z.object({
  items: z.array(z.unknown()).optional(),
  nextPageToken: z.string().optional(),
});

const uploadSchema = z.object({
  contentDetails: z.object({ videoId: z.string().regex(VIDEO_ID_PATTERN) }),
});

const videoSchema = z.object({
  id: z.string().regex(VIDEO_ID_PATTERN),
  snippet: z.object({
    title: z.string(),
    publishedAt: z.string(),
    liveBroadcastContent: z.string().optional(),
  }),
  statistics: z.object({ viewCount: count.optional() }).optional(),
  contentDetails: z.object({ duration: z.string() }),
});

/** An ISO-8601 length such as PT1H2M3S in seconds; null when it cannot be read. */
export function isoSeconds(text: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text);
  if (!match || text === 'P' || text.endsWith('T')) return null;
  const [days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  return (((days ?? 0) * 24 + (hours ?? 0)) * 60 + (minutes ?? 0)) * 60 + (seconds ?? 0);
}

export interface ApiChannelOptions extends DataApiOptions {
  /** Told of each request made, one unit each. */
  readonly onRequest?: () => void;
}

type Get = (path: string, query: Record<string, string>) => Promise<unknown>;

function getter(options: ApiChannelOptions): Get {
  const apiKey = requireKey(options.apiKey);
  const fetcher = apiFetcher(options);
  return async (path, query) => {
    options.onRequest?.();
    return apiGet(path, new URLSearchParams(query), apiKey, fetcher);
  };
}

async function uploadIds(get: Get, playlistId: string, most: number): Promise<string[]> {
  let ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const reply = listSchema.parse(
      await get('playlistItems', {
        part: 'contentDetails',
        playlistId,
        maxResults: String(PAGE_SIZE),
        ...(pageToken ? { pageToken } : {}),
      }),
    );
    const found = (reply.items ?? []).flatMap((raw) => {
      const item = uploadSchema.safeParse(raw);
      return item.success ? [item.data.contentDetails.videoId] : [];
    });
    ids = [...ids, ...found];
    pageToken = reply.nextPageToken;
  } while (pageToken !== undefined && ids.length < most);
  return ids.slice(0, most);
}

function toVideo(raw: unknown, channelId: string): VideoItem | null {
  const parsed = videoSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { id, snippet, statistics, contentDetails } = parsed.data;
  const seconds = isoSeconds(contentDetails.duration);
  const date = new Date(snippet.publishedAt);
  const live = (snippet.liveBroadcastContent ?? 'none') !== 'none';
  if (
    live ||
    seconds === null ||
    seconds <= API_MAX_SHORT_SECONDS ||
    Number.isNaN(date.getTime())
  ) {
    return null;
  }
  return {
    id,
    channelId,
    title: snippet.title.slice(0, MAX_TITLE),
    views: statistics?.viewCount ?? null,
    durationSeconds: seconds,
    published: { date, precision: 'hour', raw: snippet.publishedAt.slice(0, 10) },
  };
}

async function videosOf(get: Get, ids: readonly string[], channelId: string) {
  let videos: VideoItem[] = [];
  for (let start = 0; start < ids.length; start += PAGE_SIZE) {
    const reply = listSchema.parse(
      await get('videos', {
        part: 'snippet,statistics,contentDetails',
        id: ids.slice(start, start + PAGE_SIZE).join(','),
        maxResults: String(PAGE_SIZE),
      }),
    );
    videos = [...videos, ...(reply.items ?? []).flatMap((raw) => toVideo(raw, channelId) ?? [])];
  }
  return videos;
}

/** One channel and up to `maxVideos` of its newest uploads, through the official API. */
export async function fetchApiChannel(
  channelId: string,
  maxVideos: number,
  options: ApiChannelOptions,
): Promise<ChannelSnapshot> {
  if (!CHANNEL_ID_PATTERN.test(channelId)) throw new Error('Not a valid YouTube channel id');
  const get = getter(options);
  const reply = listSchema.parse(
    await get('channels', { part: 'snippet,statistics,contentDetails', id: channelId }),
  );
  const parsed = channelSchema.safeParse(reply.items?.[0]);
  if (!parsed.success) throw new Error(`The YouTube API does not know channel ${channelId}`);
  const { snippet, statistics, contentDetails } = parsed.data;
  const hidden = statistics?.hiddenSubscriberCount ?? false;
  const ids = await uploadIds(get, contentDetails.relatedPlaylists.uploads, maxVideos);
  return {
    channel: {
      id: channelId,
      title: snippet.title.slice(0, MAX_TITLE),
      handle: snippet.customUrl?.startsWith('@') ? snippet.customUrl : null,
      subscribers: hidden ? null : (statistics?.subscriberCount ?? null),
      subscribersHidden: hidden,
      videoCount: statistics?.videoCount ?? null,
    },
    videos: await videosOf(get, ids, channelId),
  };
}

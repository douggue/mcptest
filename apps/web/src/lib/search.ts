/**
 * The top bar's search: what a pasted YouTube link names, and the stored
 * channels and videos a few typed letters match. Every stored channel and
 * every stored video is searched on the server; the channels already on
 * screen are matched here first, so the first results show at once.
 */
import type { BankVideo } from '@jgtube/core';
import {
  CHANNEL_HITS,
  MAX_SEARCH_CHARS,
  MIN_SEARCH_CHARS,
  channelOfHandle,
  matchChannels,
  type SearchChannel,
} from '@jgtube/core/src/channel/search';
import { parseChannelRef } from '@jgtube/core/src/sources/parse';
import { parseVideoRef } from '@jgtube/core/src/video/ref';
import { apiCaller, type Fetch } from './api';
import { formatCount, formatScore } from './format';

export { CHANNEL_HITS, MAX_SEARCH_CHARS, MIN_SEARCH_CHARS, channelOfHandle, matchChannels };
export type { SearchChannel };

/** What a pasted link names: a video, a channel by its id, or a channel by its @handle. */
export type LinkTarget =
  | { readonly kind: 'video'; readonly videoId: string }
  | { readonly kind: 'channel'; readonly channelId: string }
  | { readonly kind: 'handle'; readonly handle: string };

export interface VideoHit {
  readonly videoId: string;
  readonly title: string;
  readonly channelTitle: string;
  /** Views and, when the bank has one, the score, in a few words. */
  readonly meta: string;
}

export const VIDEO_HITS = 6;

const LOOKS_LIKE_LINK = /^(https?:\/\/|www\.|m\.|youtube\.com|youtu\.be)/i;
const CHANNEL_ID = /^UC[\w-]{22}$/;
/** The part of a link that names a channel. */
const CHANNEL_PATH = /\/(@|channel\/)/;

const tryParse = <T>(parse: () => T): T | null => {
  try {
    return parse();
  } catch {
    return null;
  }
};

function channelTarget(text: string): LinkTarget | null {
  const ref = tryParse(() => parseChannelRef(text));
  if (!ref) return null;
  return ref.kind === 'id'
    ? { kind: 'channel', channelId: ref.id }
    : { kind: 'handle', handle: ref.handle };
}

/**
 * What the text names when it is a YouTube link, a channel id or an
 * @handle; null for plain words, which are searched for instead.
 */
export function linkTarget(input: string): LinkTarget | null {
  const text = input.trim();
  if (text === '' || text.length > MAX_SEARCH_CHARS || /\s/.test(text)) return null;
  if (CHANNEL_ID.test(text) || text.startsWith('@')) return channelTarget(text);
  if (!LOOKS_LIKE_LINK.test(text)) return null;
  const videoId = tryParse(() => parseVideoRef(text));
  if (videoId) return { kind: 'video', videoId };
  return CHANNEL_PATH.test(text) ? channelTarget(text) : null;
}

/** One line under a channel's name in the results. */
export const channelMeta = (channel: SearchChannel): string =>
  channel.subscribers === null ? 'Channel' : `${formatCount(channel.subscribers)} subscribers`;

/** A stored video as the results list it. */
export function videoHit(video: BankVideo): VideoHit {
  const views = `${formatCount(video.views)} views`;
  return {
    videoId: video.videoId,
    title: video.title,
    channelTitle: video.channel.title,
    meta: video.score === null ? views : `${formatScore(video.score)} · ${views}`,
  };
}

/** Whether the words are worth searching the store for: not a link, and long enough. */
export const searchable = (input: string): boolean => {
  const text = input.trim();
  return text.length >= MIN_SEARCH_CHARS && text.length <= MAX_SEARCH_CHARS && !linkTarget(text);
};

/**
 * The channels to list: the ones already on screen that match, at once, and
 * then every stored channel the server found, best match first, each once.
 */
export function mergeChannels(
  words: string,
  onScreen: readonly SearchChannel[],
  stored: readonly SearchChannel[] | null,
): readonly SearchChannel[] {
  return matchChannels(words, [...(stored ?? []), ...onScreen]);
}

/** The search's own requests: every stored channel, by words or by a link. */
export function createSearchApi(fetcher?: Fetch) {
  const { call, unwrap } = apiCaller(fetcher);
  return {
    /** The stored channels the words match, on any map or none. */
    async channels(words: string): Promise<readonly SearchChannel[]> {
      const query = new URLSearchParams({ q: words.trim() });
      return unwrap<{ channels: readonly SearchChannel[] }>(
        await call(`/api/channels/search?${query.toString()}`),
      ).channels;
    },
    /** The stored channel a link, an @handle or a channel id names; null when the store has none. */
    async findChannel(ref: string): Promise<SearchChannel | null> {
      const query = new URLSearchParams({ channel: ref.trim() });
      return unwrap<{ channel: SearchChannel | null }>(
        await call(`/api/channels/find?${query.toString()}`),
      ).channel;
    },
  };
}

export type SearchApi = ReturnType<typeof createSearchApi>;

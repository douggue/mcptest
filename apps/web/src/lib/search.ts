/**
 * The top bar's search: what a pasted YouTube link names, and which stored
 * channels a few typed letters match. Stored videos are matched by the
 * outlier bank on the server, which holds every stored video.
 */
import type { BankVideo } from '@jgtube/core';
import { parseChannelRef } from '@jgtube/core/src/sources/parse';
import { parseVideoRef } from '@jgtube/core/src/video/ref';
import { formatCount, formatScore } from './format';

/** What a pasted link names: a video, a channel by its id, or a channel by its @handle. */
export type LinkTarget =
  | { readonly kind: 'video'; readonly videoId: string }
  | { readonly kind: 'channel'; readonly channelId: string }
  | { readonly kind: 'handle'; readonly handle: string };

/** A channel the search can find: one on the map on screen, or one of the owner's. */
export interface SearchChannel {
  readonly id: string;
  readonly title: string;
  readonly handle: string | null;
  readonly subscribers: number | null;
  readonly logoUrl?: string | null;
}

export interface VideoHit {
  readonly videoId: string;
  readonly title: string;
  readonly channelTitle: string;
  /** Views and, when the bank has one, the score, in a few words. */
  readonly meta: string;
}

/** Fewer letters than this match too much to be worth showing. */
export const MIN_SEARCH_CHARS = 2;
export const MAX_SEARCH_CHARS = 200;
export const CHANNEL_HITS = 5;
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

const fold = (text: string): string => text.toLowerCase().normalize('NFKD');

/** How well a channel matches: 0 its name starts with the words, 1 a word of it does, 2 it holds them. */
function rank(channel: SearchChannel, words: string): number | null {
  const title = fold(channel.title);
  const handle = fold((channel.handle ?? '').replace(/^@/, ''));
  if (title.startsWith(words) || handle.startsWith(words.replace(/^@/, ''))) return 0;
  if (title.split(/\s+/).some((word) => word.startsWith(words))) return 1;
  return title.includes(words) || (handle !== '' && handle.includes(words)) ? 2 : null;
}

/** The stored channels a few letters match, best first, each once. */
export function matchChannels(
  query: string,
  channels: readonly SearchChannel[],
  limit: number = CHANNEL_HITS,
): readonly SearchChannel[] {
  const words = fold(query.trim());
  if (words.length < MIN_SEARCH_CHARS) return [];
  const seen = new Set<string>();
  const ranked = channels.flatMap((channel) => {
    if (seen.has(channel.id)) return [];
    seen.add(channel.id);
    const at = rank(channel, words);
    return at === null ? [] : [{ channel, at }];
  });
  return [...ranked]
    .sort((a, b) => a.at - b.at || (b.channel.subscribers ?? 0) - (a.channel.subscribers ?? 0))
    .slice(0, limit)
    .map((entry) => entry.channel);
}

/** A stored channel whose @handle is the one a link names; null when none is stored. */
export function channelOfHandle(
  handle: string,
  channels: readonly SearchChannel[],
): SearchChannel | null {
  const wanted = fold(handle.replace(/^@/, ''));
  return (
    channels.find((channel) => fold((channel.handle ?? '').replace(/^@/, '')) === wanted) ?? null
  );
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

/** Whether the words are worth asking the bank about: not a link, and long enough. */
export const searchable = (input: string): boolean => {
  const text = input.trim();
  return text.length >= MIN_SEARCH_CHARS && text.length <= MAX_SEARCH_CHARS && !linkTarget(text);
};

/**
 * YouTube's public upload feeds: an Atom document listing a channel's fifteen
 * newest uploads, or, through the channel's Shorts-only list, its fifteen
 * newest Shorts. They need no API key and cost nothing of the day's
 * allowance, which is why followed channels are watched through them first.
 *
 * They are not part of the documented Data API. Their shape was checked by
 * hand on two channels only, so everything read from one is treated as
 * untrusted: ids must have the right shape, the document is cut off at a
 * fixed size, and anything unexpected gives a typed result, never a throw.
 * No XML library is used: the handful of fields needed sit in flat elements
 * that a few careful patterns read, and a parser dependency would be far more
 * code to trust than this file.
 */
import { z } from 'zod';
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from './ids';

const FEED_BASE = 'https://www.youtube.com/feeds/videos.xml';
export const FEED_TIMEOUT_MS = 15_000;
/**
 * A feed of fifteen entries is a few tens of kilobytes. Anything past half a
 * megabyte is not a feed, and is not read into memory to find that out.
 */
export const FEED_MAX_BYTES = 512 * 1024;
const MAX_TITLE_LENGTH = 300;
const MAX_ERROR_TEXT = 200;
const NOT_MODIFIED = 304;
const NOT_FOUND = 404;
/** The prefix of a channel id, and of the list that holds only its Shorts. */
const CHANNEL_PREFIX = 'UC';
const SHORTS_LIST_PREFIX = 'UUSH';

export interface FeedEntry {
  readonly videoId: string;
  readonly channelId: string;
  /** The title with XML's character codes read; still untrusted text. */
  readonly title: string;
  readonly publishedAt: Date;
  /** Null when the feed gives no view count for the entry. */
  readonly views: number | null;
  /** Whether the entry's link is a Shorts address; null when it has no link. */
  readonly shortsLink: boolean | null;
}

/** What a reply said about itself, to be sent back next time; null for what it did not say. */
export interface FeedValidators {
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export type FeedResult =
  | {
      readonly kind: 'ok';
      readonly entries: readonly FeedEntry[];
      /** Entries that could not be read and were left out. */
      readonly skipped: number;
      readonly validators: FeedValidators;
    }
  /** The feed has not changed since the validators sent. */
  | { readonly kind: 'not_modified' }
  /** YouTube knows no such feed: a channel with no Shorts list, or one that is gone. */
  | { readonly kind: 'not_found' }
  /** The network, a refusal, a document too large, or one that is not a feed. */
  | { readonly kind: 'failed'; readonly message: string };

export interface FeedOptions {
  /** Replaces the network; used by tests. */
  readonly fetch?: typeof fetch;
  /** What the last reply for this feed said about itself, if anything. */
  readonly validators?: FeedValidators;
  /** Aborted when the service is stopping. */
  readonly signal?: AbortSignal;
}

/** The feed of a channel's fifteen newest uploads. */
export const channelFeedUrl = (channelId: string): string =>
  `${FEED_BASE}?channel_id=${encodeURIComponent(channelId)}`;

/** The feed of a channel's fifteen newest Shorts: its Shorts-only list. */
export const shortsFeedUrl = (channelId: string): string =>
  `${FEED_BASE}?playlist_id=${SHORTS_LIST_PREFIX}${encodeURIComponent(channelId.slice(CHANNEL_PREFIX.length))}`;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const fromCodePoint = (code: number, whole: string): string =>
  Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;

/** Reads XML's character codes (`&amp;`, `&#39;`, `&#x27;`); anything else is left as written. */
export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name.startsWith('#x')) return fromCodePoint(Number.parseInt(name.slice(2), 16), whole);
    if (name.startsWith('#')) return fromCodePoint(Number.parseInt(name.slice(1), 10), whole);
    return NAMED_ENTITIES[name] ?? whole;
  });
}

/** The text of an element: CDATA sections taken as written, the rest with its codes read. */
function textOf(inner: string): string {
  const parts = inner.split(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  // Odd places hold what was inside a CDATA section.
  return parts
    .map((part, index) => (index % 2 === 1 ? part : decodeXml(part.replace(/<[^>]*>/g, ''))))
    .join('')
    .trim();
}

const escapeForPattern = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text inside the first `<name>` element of the block; null when there is none. */
function element(block: string, name: string): string | null {
  const tag = escapeForPattern(name);
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  return match?.[1] === undefined ? null : textOf(match[1]);
}

/** The value of an attribute of the first `<name ...>` tag that satisfies `where`. */
function attribute(block: string, name: string, attr: string, where?: RegExp): string | null {
  const tags = block.match(new RegExp(`<${escapeForPattern(name)}\\s[^>]*>`, 'g')) ?? [];
  const tag = tags.find((candidate) => where === undefined || where.test(candidate));
  const match = tag === undefined ? null : new RegExp(`\\s${attr}="([^"]*)"`).exec(tag);
  return match?.[1] === undefined ? null : decodeXml(match[1]);
}

const moment = z
  .string()
  .transform((text) => new Date(text))
  .refine((date) => !Number.isNaN(date.getTime()));

const entrySchema = z.object({
  videoId: z.string().regex(VIDEO_ID_PATTERN),
  channelId: z.string().regex(CHANNEL_ID_PATTERN),
  title: z.string().transform((text) => text.slice(0, MAX_TITLE_LENGTH)),
  publishedAt: moment,
  views: z
    .string()
    .regex(/^\d{1,15}$/)
    .transform((text) => Number(text))
    .nullable()
    .catch(null),
  link: z.string().nullable(),
});

function readEntry(block: string): FeedEntry | null {
  const parsed = entrySchema.safeParse({
    videoId: element(block, 'yt:videoId'),
    channelId: element(block, 'yt:channelId'),
    title: element(block, 'title') ?? '',
    publishedAt: element(block, 'published'),
    views: attribute(block, 'media:statistics', 'views'),
    link: attribute(block, 'link', 'href', /\srel="alternate"/),
  });
  if (!parsed.success) return null;
  const { link, ...entry } = parsed.data;
  return { ...entry, shortsLink: link === null ? null : link.includes('/shorts/') };
}

/**
 * Reads an Atom document as YouTube writes its feeds. Null when the text is
 * not a feed at all; a feed with no entries is a feed, and gives none.
 */
export function parseFeed(
  xml: string,
): { readonly entries: readonly FeedEntry[]; readonly skipped: number } | null {
  if (!/<feed[\s>]/.test(xml) || !/<\/feed>\s*$/.test(xml)) return null;
  const blocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) ?? [];
  const entries = blocks.flatMap((block) => {
    const entry = readEntry(block);
    return entry === null ? [] : [entry];
  });
  return { entries, skipped: blocks.length - entries.length };
}

/** The body as text, or null once it passes the size limit. */
async function readCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > FEED_MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** The validators are sent back only when a previous reply gave them. */
function requestHeaders(validators: FeedValidators | undefined): Record<string, string> {
  return {
    ...(validators?.etag ? { 'if-none-match': validators.etag } : {}),
    ...(validators?.lastModified ? { 'if-modified-since': validators.lastModified } : {}),
  };
}

const failed = (message: string): FeedResult => ({
  kind: 'failed',
  message: message.slice(0, MAX_ERROR_TEXT),
});

async function readReply(response: Response): Promise<FeedResult> {
  if (response.status === NOT_MODIFIED) return { kind: 'not_modified' };
  if (response.status === NOT_FOUND) return { kind: 'not_found' };
  if (!response.ok) return failed(`YouTube refused the feed (${response.status})`);
  const xml = await readCapped(response);
  if (xml === null) return failed('The feed was larger than a feed should be');
  const feed = parseFeed(xml);
  if (feed === null) return failed('What YouTube sent was not a feed');
  return {
    kind: 'ok',
    ...feed,
    validators: {
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    },
  };
}

/**
 * Fetches and reads one feed. Never throws: a timeout, a network fault, a
 * refusal, a redirect (not followed) and a document that is not a feed all
 * come back as `failed`, with a message of our own.
 */
export async function fetchFeed(url: string, options: FeedOptions = {}): Promise<FeedResult> {
  const timeout = AbortSignal.timeout(FEED_TIMEOUT_MS);
  const signal =
    options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
  try {
    const response = await (options.fetch ?? fetch)(url, {
      headers: requestHeaders(options.validators),
      // A feed is read from YouTube's own address or not at all.
      redirect: 'error',
      signal,
    });
    return await readReply(response);
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return failed(`YouTube did not send the feed within ${FEED_TIMEOUT_MS / 1000} seconds`);
    }
    return failed(
      `The feed could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

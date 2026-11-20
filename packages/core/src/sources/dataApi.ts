/**
 * Channel facts from the official YouTube Data API: the things the web pages
 * do not show or only show rounded. Chiefly the exact day a channel was
 * created, its country and its exact totals.
 *
 * It needs the owner's own API key and costs one unit of the key's daily
 * allowance (10,000 by default) per fifty channels. It cannot read
 * recommendations, which is why the crawl does not use it.
 */
import { z } from 'zod';
import { CHANNEL_ID_PATTERN } from './parse';

const ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels';
/** The API's own limit on ids per request. */
const MAX_IDS_PER_REQUEST = 50;
/** Sent as a header so the key never appears in an address, a log or an error. */
const KEY_HEADER = 'x-goog-api-key';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ERROR_TEXT = 200;
const QUOTA_REASONS: readonly string[] = ['quotaExceeded', 'dailyLimitExceeded'];

export interface ChannelFacts {
  readonly id: string;
  /** When the channel account was created, which can be long before its first upload. */
  readonly createdAt: Date;
  /** Two-letter country the owner set, or null when they set none. */
  readonly country: string | null;
  readonly totalViews: number | null;
  readonly videoCount: number | null;
  readonly subscribers: number | null;
  readonly subscribersHidden: boolean;
}

export interface DataApiOptions {
  /** The owner's key, from the YOUTUBE_API_KEY setting. Never stored or logged. */
  readonly apiKey: string;
  /** Replaces the network; used by tests. */
  readonly fetch?: typeof fetch;
}

const count = z
  .string()
  .regex(/^\d+$/)
  .transform((text) => Number(text));

const itemSchema = z.object({
  id: z.string().regex(CHANNEL_ID_PATTERN),
  snippet: z.object({
    publishedAt: z
      .string()
      .transform((text) => new Date(text))
      .refine((date) => !Number.isNaN(date.getTime())),
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
});

const replySchema = z.object({ items: z.array(z.unknown()).optional() });

const errorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});

function toFacts(raw: unknown): ChannelFacts | null {
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { id, snippet, statistics } = parsed.data;
  const subscribersHidden = statistics?.hiddenSubscriberCount ?? false;
  return {
    id,
    createdAt: snippet.publishedAt,
    country: snippet.country ?? null,
    totalViews: statistics?.viewCount ?? null,
    videoCount: statistics?.videoCount ?? null,
    subscribers: subscribersHidden ? null : (statistics?.subscriberCount ?? null),
    subscribersHidden,
  };
}

/** Turns a refusal into a message the owner can act on, with the key removed from it. */
async function refusal(response: Response, apiKey: string): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = errorSchema.safeParse(body);
  const reasons = parsed.success
    ? (parsed.data.error.errors ?? []).map((entry) => entry.reason ?? '')
    : [];
  if (reasons.some((reason) => QUOTA_REASONS.includes(reason))) {
    return new Error(
      'The YouTube API key has used up its daily allowance. It resets at midnight Pacific time.',
    );
  }
  const detail = (parsed.success ? (parsed.data.error.message ?? '') : '')
    .split(apiKey)
    .join('[key]')
    .slice(0, MAX_ERROR_TEXT);
  return new Error(`The YouTube API refused the request (${response.status}): ${detail}`);
}

async function fetchBatch(
  ids: readonly string[],
  apiKey: string,
  fetcher: typeof fetch,
): Promise<readonly ChannelFacts[]> {
  const query = new URLSearchParams({
    part: 'snippet,statistics',
    id: ids.join(','),
    maxResults: String(MAX_IDS_PER_REQUEST),
  });
  const response = await fetcher(`${ENDPOINT}?${query.toString()}`, {
    headers: { [KEY_HEADER]: apiKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw await refusal(response, apiKey);
  const reply = replySchema.safeParse(await response.json());
  if (!reply.success) throw new Error('The YouTube API sent a reply that could not be read');
  return (reply.data.items ?? []).flatMap((raw) => {
    const facts = toFacts(raw);
    return facts ? [facts] : [];
  });
}

/**
 * Reads the facts for the given channels, fifty per request. A channel the API
 * does not know, or an entry that cannot be read, is simply absent from the
 * result; a refused request fails the whole call.
 */
export async function fetchChannelFacts(
  channelIds: readonly string[],
  options: DataApiOptions,
): Promise<readonly ChannelFacts[]> {
  const apiKey = options.apiKey.trim();
  if (apiKey === '') {
    throw new Error('No YouTube API key is set. Put one in the YOUTUBE_API_KEY setting.');
  }
  const invalid = channelIds.find((id) => !CHANNEL_ID_PATTERN.test(id));
  if (invalid !== undefined) {
    throw new Error(`Not a valid YouTube channel id: "${invalid.slice(0, 40)}"`);
  }
  const fetcher = options.fetch ?? fetch;
  let facts: readonly ChannelFacts[] = [];
  for (let start = 0; start < channelIds.length; start += MAX_IDS_PER_REQUEST) {
    const batch = channelIds.slice(start, start + MAX_IDS_PER_REQUEST);
    facts = [...facts, ...(await fetchBatch(batch, apiKey, fetcher))];
  }
  return facts;
}

/**
 * One request to the official YouTube Data API, shared by every call in
 * `dataApi.ts`: the key goes in a header, the cost is counted before the
 * request leaves, and a refusal comes back as a message the owner can act on.
 */
import { z } from 'zod';
import type { QuotaKind } from '../quota/kinds';

const API_BASE = 'https://www.googleapis.com/youtube/v3';
/** Sent as a header so the key never appears in an address, a log or an error. */
const KEY_HEADER = 'x-goog-api-key';
export const REQUEST_TIMEOUT_MS = 20_000;
const MS_PER_SECOND = 1000;
const MAX_ERROR_TEXT = 200;
const KEY_PLACEHOLDER = '[key]';
const QUOTA_REASONS: readonly string[] = ['quotaExceeded', 'dailyLimitExceeded'];
/** Too many requests in a short time: a reason to wait a while, not the day's allowance. */
const RATE_REASONS: readonly string[] = ['rateLimitExceeded', 'userRateLimitExceeded'];
const QUOTA_SPENT =
  'The YouTube API key has used up its daily allowance. It resets at midnight Pacific time.';
const RATE_LIMITED = 'The YouTube API is being asked too fast. Wait a while before asking again.';

/**
 * Counts units against the day's allowance. Called before each request; when
 * it throws (or rejects) the request is not made.
 */
export type Spend = (kind: QuotaKind, units: number) => void | Promise<void>;

export interface DataApiOptions {
  /** The owner's key, from the YOUTUBE_API_KEY setting. Never stored or logged. */
  readonly apiKey: string;
  /** Where the cost of each request is recorded: the ledger's `spend`. */
  readonly spend: Spend;
  /**
   * The share of the day's plan that pays, when it is not the call's usual
   * one: `reserve` for a retry or a search asked for by hand.
   */
  readonly kind?: QuotaKind;
  /** Replaces the network; used by tests. */
  readonly fetch?: typeof fetch;
}

/** What one request costs and which share of the plan it is usually paid from. */
export interface Cost {
  readonly kind: QuotaKind;
  readonly units: number;
}

export interface Page {
  readonly items: readonly unknown[];
  /** Present when the list goes on. */
  readonly nextPageToken: string | null;
}

/** A request the API answered with a refusal. The message never contains the key. */
export class YouTubeApiError extends Error {
  constructor(
    message: string,
    /** The HTTP status of the refusal, such as 403 or 404. */
    readonly status: number,
    /** True when the refusal is the daily allowance running out. */
    readonly quotaSpent: boolean,
    /** True when the refusal is for asking too fast: wait, then carry on the same day. */
    readonly rateLimited: boolean = false,
  ) {
    super(message);
    this.name = 'YouTubeApiError';
  }
}

const replySchema = z.object({
  items: z.array(z.unknown()).optional(),
  nextPageToken: z.string().min(1).optional(),
});

const errorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    errors: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});

const withoutKey = (text: string, apiKey: string): string =>
  text.split(apiKey).join(KEY_PLACEHOLDER).slice(0, MAX_ERROR_TEXT);

export function requireKey(apiKey: string): string {
  const key = apiKey.trim();
  if (key === '') {
    throw new Error('No YouTube API key is set. Put one in the YOUTUBE_API_KEY setting.');
  }
  return key;
}

/** Turns a refusal into a message the owner can act on, with the key removed from it. */
async function refusal(response: Response, apiKey: string): Promise<YouTubeApiError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = errorSchema.safeParse(body);
  const reasons = parsed.success
    ? (parsed.data.error.errors ?? []).map((entry) => entry.reason ?? '')
    : [];
  if (reasons.some((reason) => QUOTA_REASONS.includes(reason))) {
    return new YouTubeApiError(QUOTA_SPENT, response.status, true);
  }
  if (reasons.some((reason) => RATE_REASONS.includes(reason))) {
    return new YouTubeApiError(RATE_LIMITED, response.status, false, true);
  }
  const detail = withoutKey(parsed.success ? (parsed.data.error.message ?? '') : '', apiKey);
  return new YouTubeApiError(
    `The YouTube API refused the request (${response.status}): ${detail}`,
    response.status,
    false,
  );
}

/** Sends the request, turning a timeout or a network failure into a plain message. */
async function send(url: string, apiKey: string, fetcher: typeof fetch): Promise<Response> {
  try {
    return await fetcher(url, {
      headers: { [KEY_HEADER]: apiKey },
      // The key is sent to Google only: a reply that points elsewhere is not followed.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      const seconds = REQUEST_TIMEOUT_MS / MS_PER_SECOND;
      throw new Error(`The YouTube API did not answer within ${seconds} seconds`, { cause: error });
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The YouTube API could not be reached: ${withoutKey(reason, apiKey)}`);
  }
}

/**
 * One GET to the API, after counting its cost. Returns the reply's items and
 * the token of the next page, or throws the refusal as a YouTubeApiError.
 */
export async function getPage(
  path: string,
  query: URLSearchParams,
  cost: Cost,
  options: DataApiOptions,
): Promise<Page> {
  const apiKey = requireKey(options.apiKey);
  await options.spend(options.kind ?? cost.kind, cost.units);
  const response = await send(
    `${API_BASE}/${path}?${query.toString()}`,
    apiKey,
    options.fetch ?? fetch,
  );
  if (!response.ok) throw await refusal(response, apiKey);
  const body: unknown = await response.json().catch(() => null);
  const reply = replySchema.safeParse(body);
  if (!reply.success) throw new Error('The YouTube API sent a reply that could not be read');
  return { items: reply.data.items ?? [], nextPageToken: reply.data.nextPageToken ?? null };
}

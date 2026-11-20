/**
 * Finds channels by subject instead of by recommendation.
 *
 * The crawl only reaches channels YouTube shows beside ones already known. A
 * keyword search reaches into niches nobody has pointed the tool at: it asks
 * for the most-viewed recent videos on a subject and reads the channels behind
 * them into the store, where the niche list can judge them.
 */
import { ingestChannel, type IngestDeps } from '../ingest';
import type { SearchHit } from '../sources/dataApi';

export const DEFAULT_SINCE_DAYS = 90;
/** Channels read per keyword. Each costs a few page requests, so this bounds one search's cost. */
export const DEFAULT_MAX_CHANNELS = 25;
const MAX_CHANNELS_LIMIT = 50;
const MAX_SINCE_DAYS = 365;
const MAX_KEYWORD_LENGTH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DiscoveryDeps extends IngestDeps {
  /** Finds recent videos on a subject. In the app this is the official API's search. */
  readonly search: (
    query: string,
    options: { readonly publishedAfter: Date },
  ) => Promise<readonly SearchHit[]>;
}

export interface DiscoveryOptions {
  /** Only videos published within this many days count. */
  readonly sinceDays?: number;
  /** The most channels to read into the store. */
  readonly maxChannels?: number;
}

export interface DiscoveryFailure {
  readonly channelId: string;
  readonly error: string;
}

export interface DiscoveryResult {
  readonly keyword: string;
  readonly videosFound: number;
  /** Distinct channels behind those videos, including any beyond the limit. */
  readonly channelsFound: number;
  /** Channels read into the store by this search. */
  readonly added: readonly string[];
  /** Channels the store already held fresh, so nothing was fetched. */
  readonly alreadyKnown: readonly string[];
  readonly failed: readonly DiscoveryFailure[];
}

function assertWholeNumber(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a whole number from ${min} to ${max}`);
  }
}

/** Channel ids behind the hits: most matching videos first, then in the order they appeared. */
function rankChannels(hits: readonly SearchHit[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const hit of hits) counts.set(hit.channelId, (counts.get(hit.channelId) ?? 0) + 1);
  // Array sort is stable, so equal counts keep the search's own order.
  return [...counts].sort((a, b) => b[1] - a[1]).map(([channelId]) => channelId);
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Searches for recent videos on a subject and reads the channels behind them
 * into the store. A channel that cannot be read is reported and skipped.
 */
export async function discoverByKeyword(
  deps: DiscoveryDeps,
  keyword: string,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const query = keyword.trim();
  if (query === '' || query.length > MAX_KEYWORD_LENGTH) {
    throw new Error(`Give a keyword of 1 to ${MAX_KEYWORD_LENGTH} characters`);
  }
  const sinceDays = options.sinceDays ?? DEFAULT_SINCE_DAYS;
  const maxChannels = options.maxChannels ?? DEFAULT_MAX_CHANNELS;
  assertWholeNumber('sinceDays', sinceDays, 1, MAX_SINCE_DAYS);
  assertWholeNumber('maxChannels', maxChannels, 1, MAX_CHANNELS_LIMIT);

  const publishedAfter = new Date(deps.now().getTime() - sinceDays * DAY_MS);
  const hits = await deps.search(query, { publishedAfter });
  const ranked = rankChannels(hits);

  let added: readonly string[] = [];
  let alreadyKnown: readonly string[] = [];
  let failed: readonly DiscoveryFailure[] = [];
  for (const channelId of ranked.slice(0, maxChannels)) {
    try {
      const { fromCache } = await ingestChannel(deps, channelId);
      if (fromCache) alreadyKnown = [...alreadyKnown, channelId];
      else added = [...added, channelId];
    } catch (error) {
      failed = [...failed, { channelId, error: messageOf(error) }];
    }
  }
  return {
    keyword: query,
    videosFound: hits.length,
    channelsFound: ranked.length,
    added,
    alreadyKnown,
    failed,
  };
}

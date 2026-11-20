/** search.list: one page of videos on a subject, for 100 units. */
import { z } from 'zod';
import { getPage, type Cost, type DataApiOptions } from './client';
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from './ids';
import { MAX_PER_REQUEST, shortText, timestamp } from './parse';

/** What the API charges for one search, whatever it returns. */
export const SEARCH_COST_UNITS = 100;
const SEARCH_COST: Cost = { kind: 'search', units: SEARCH_COST_UNITS };
const MAX_QUERY_LENGTH = 200;
const REGION_PATTERN = /^[A-Z]{2}$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

export interface SearchHit {
  readonly videoId: string;
  readonly channelId: string;
  readonly channelTitle: string;
  /** As the search returns it, which may contain HTML character codes such as &#39;. */
  readonly title: string;
  readonly publishedAt: Date;
  /** Its place in the search's results, 1 for the first, counting entries that could not be read. */
  readonly rank: number;
}

/**
 * How the results are ordered. `viewCount`: the most-viewed first. `date`:
 * the newest first.
 */
export type SearchOrder = 'viewCount' | 'date';

export interface SearchResult {
  readonly hits: readonly SearchHit[];
  /** Results the API sent that were not readable videos. */
  readonly skipped: number;
  /** True when the API sent as many results as one page holds: there may be more behind them. */
  readonly fullPage: boolean;
}

export interface SearchOptions extends DataApiOptions {
  readonly order: SearchOrder;
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
  .transform(({ id, snippet }): Omit<SearchHit, 'rank'> => ({
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
    order: options.order,
    publishedAfter: options.publishedAfter.toISOString(),
    regionCode: options.regionCode,
    ...(language === undefined ? {} : { relevanceLanguage: language }),
    ...(options.shortOnly ? { videoDuration: 'short' } : {}),
    maxResults: String(MAX_PER_REQUEST),
  });
}

/**
 * The videos on a subject published since a date, as seen from one country,
 * most-viewed or newest first: one page of up to fifty, for 100 units of the
 * key's daily allowance. Results that are not readable videos are left out
 * and counted; the others keep the place the API gave them.
 */
export async function searchRecentVideos(
  query: string,
  options: SearchOptions,
): Promise<SearchResult> {
  const params = searchParams(query.trim(), options);
  const page = await getPage('search', params, SEARCH_COST, options);
  const hits = page.items.flatMap((entry, index): SearchHit[] => {
    const parsed = hitSchema.safeParse(entry);
    return parsed.success ? [{ ...parsed.data, rank: index + 1 }] : [];
  });
  return {
    hits,
    skipped: page.items.length - hits.length,
    fullPage: page.items.length >= MAX_PER_REQUEST,
  };
}

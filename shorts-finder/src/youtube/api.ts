/**
 * The three calls the cycles make, bound to one key and one ledger, so a cycle
 * is handed "the API" and a test can hand it another.
 */
import type { QuotaKind } from '../quota/kinds';
import {
  fetchChannels,
  fetchVideos,
  searchRecentVideos,
  type ChannelFacts,
  type DataApiOptions,
  type ListResult,
  type SearchResult,
  type VideoFacts,
} from './dataApi';

export interface SearchRequest {
  readonly publishedAfter: Date;
  readonly regionCode: string;
  readonly relevanceLanguage?: string;
  readonly shortOnly: boolean;
}

export interface YouTubeApi {
  /** One search, 100 units of the search share. Rejects when the request fails. */
  searchRecentVideos(query: string, request: SearchRequest): Promise<SearchResult>;
  /**
   * The facts of up to any number of videos, 1 unit per fifty, from the
   * reading share unless `paidFrom` names another. A failed request is
   * reported in the result, not thrown.
   */
  fetchVideos(ids: readonly string[], paidFrom?: QuotaKind): Promise<ListResult<VideoFacts>>;
  /** The facts of channels, 1 unit per fifty, from the channel share. */
  fetchChannels(ids: readonly string[]): Promise<ListResult<ChannelFacts>>;
}

/** The official API behind the cycles' three calls. */
export function createYouTubeApi(options: DataApiOptions): YouTubeApi {
  return {
    searchRecentVideos: (query, request) => searchRecentVideos(query, { ...options, ...request }),
    fetchVideos: (ids, paidFrom) =>
      fetchVideos(ids, paidFrom === undefined ? options : { ...options, kind: paidFrom }),
    fetchChannels: (ids) => fetchChannels(ids, options),
  };
}

/**
 * The official YouTube Data API reader: a search for recent videos on a
 * subject, the facts of videos and channels, and the videos in a list. Each
 * call lives in a file of its own; this is the one place the rest of the
 * program imports them from.
 *
 * It needs the owner's own API key. Every request is counted against the
 * key's daily allowance through `options.spend` before it is sent: a search
 * costs 100 units, everything else 1 unit per request of up to fifty.
 */
export { REQUEST_TIMEOUT_MS, YouTubeApiError } from './client';
export type { DataApiOptions, Spend } from './client';
export { fetchChannels, type ChannelFacts } from './channels';
export type { ListResult } from './parse';
export { fetchPlaylistVideoIds, type PlaylistOptions, type PlaylistVideoIds } from './playlist';
export {
  SEARCH_COST_UNITS,
  searchRecentVideos,
  type SearchHit,
  type SearchOptions,
  type SearchOrder,
  type SearchResult,
} from './search';
export { fetchVideos, type VideoFacts } from './videos';

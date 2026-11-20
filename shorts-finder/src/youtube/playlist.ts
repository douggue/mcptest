/** playlistItems.list: the videos in a list, fifty to a page of 1 unit. */
import { z } from 'zod';
import { YouTubeApiError, getPage, type Cost, type DataApiOptions } from './client';
import { PLAYLIST_ID_PATTERN, VIDEO_ID_PATTERN } from './ids';
import { MAX_PER_REQUEST, readable } from './parse';

const PLAYLIST_COST: Cost = { kind: 'channel', units: 1 };
const NOT_FOUND = 404;

export interface PlaylistOptions extends DataApiOptions {
  /** The most pages (of fifty videos, 1 unit each) to read before stopping. */
  readonly maxPages: number;
}

export interface PlaylistVideoIds {
  /** In the list's own order, which for an uploads list is newest first. */
  readonly videoIds: readonly string[];
  /** True when the API knows no such list. Not a failure: some lists exist only for some channels. */
  readonly notFound: boolean;
  /** False when the page limit was reached, or a later page was gone, and the list goes on. */
  readonly complete: boolean;
  /** Entries the API sent that held no readable video id. */
  readonly skipped: number;
}

const playlistItemSchema = z
  .object({ contentDetails: z.object({ videoId: z.string().regex(VIDEO_ID_PATTERN) }) })
  .transform((item) => item.contentDetails.videoId);

function playlistQuery(playlistId: string, pageToken: string | null): URLSearchParams {
  return new URLSearchParams({
    part: 'contentDetails',
    playlistId,
    maxResults: String(MAX_PER_REQUEST),
    ...(pageToken === null ? {} : { pageToken }),
  });
}

/**
 * The ids of the videos in a list, page by page up to `maxPages`, at 1 unit a
 * page. A list the API does not know (a 404 on its first page) gives an empty
 * result marked `notFound` instead of failing. A 404 on a later page keeps the
 * pages already read and marks the result incomplete. Any other refusal fails the call.
 */
export async function fetchPlaylistVideoIds(
  playlistId: string,
  options: PlaylistOptions,
): Promise<PlaylistVideoIds> {
  if (!PLAYLIST_ID_PATTERN.test(playlistId)) throw new Error('Not a valid YouTube list id');
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1) {
    throw new Error('Give a whole number of pages, at least 1');
  }
  let videoIds: readonly string[] = [];
  let skipped = 0;
  let pageToken: string | null = null;
  for (let read = 0; read < options.maxPages; read += 1) {
    try {
      const query = playlistQuery(playlistId, pageToken);
      const page = await getPage('playlistItems', query, PLAYLIST_COST, options);
      const ids = readable(page.items, playlistItemSchema);
      videoIds = [...videoIds, ...ids.items];
      skipped += ids.skipped;
      pageToken = page.nextPageToken;
    } catch (error) {
      if (!(error instanceof YouTubeApiError) || error.status !== NOT_FOUND) throw error;
      // Only a list unknown from its first page is "not found"; later, the list changed under the read.
      return { videoIds, notFound: read === 0, complete: read === 0, skipped };
    }
    if (pageToken === null) return { videoIds, notFound: false, complete: true, skipped };
  }
  return { videoIds, notFound: false, complete: false, skipped };
}

/** channels.list: the facts of channels, fifty to a request of 1 unit. */
import { z } from 'zod';
import { getPage, type Cost, type DataApiOptions } from './client';
import { CHANNEL_ID_PATTERN, PLAYLIST_ID_PATTERN } from './ids';
import { count, readInBatches, requireIds, shortText, timestamp, type ListResult } from './parse';

const CHANNELS_COST: Cost = { kind: 'channel', units: 1 };

export interface ChannelFacts {
  readonly id: string;
  readonly title: string;
  /** When the channel account was created, which can be long before its first upload. */
  readonly createdAt: Date;
  /** Two-letter country the channel's owner set, or null when they set none. */
  readonly country: string | null;
  readonly totalViews: number | null;
  readonly videoCount: number | null;
  /** Rounded by the API to three figures; null when hidden. */
  readonly subscribers: number | null;
  readonly subscribersHidden: boolean;
  /** The list holding every upload of the channel, for `fetchPlaylistVideoIds`. */
  readonly uploadsPlaylistId: string | null;
}

const channelSchema = z
  .object({
    id: z.string().regex(CHANNEL_ID_PATTERN),
    snippet: z.object({
      title: shortText,
      publishedAt: timestamp,
      country: z.string().max(10).optional().catch(undefined),
    }),
    statistics: z
      .object({
        viewCount: count.optional().catch(undefined),
        videoCount: count.optional().catch(undefined),
        subscriberCount: count.optional().catch(undefined),
        hiddenSubscriberCount: z.boolean().optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    contentDetails: z
      .object({
        relatedPlaylists: z
          .object({ uploads: z.string().regex(PLAYLIST_ID_PATTERN).optional().catch(undefined) })
          .optional()
          .catch(undefined),
      })
      .optional()
      .catch(undefined),
  })
  .transform(({ id, snippet, statistics, contentDetails }): ChannelFacts => {
    const subscribersHidden = statistics?.hiddenSubscriberCount ?? false;
    return {
      id,
      title: snippet.title,
      createdAt: snippet.publishedAt,
      country: snippet.country ?? null,
      totalViews: statistics?.viewCount ?? null,
      videoCount: statistics?.videoCount ?? null,
      subscribers: subscribersHidden ? null : (statistics?.subscriberCount ?? null),
      subscribersHidden,
      uploadsPlaylistId: contentDetails?.relatedPlaylists?.uploads ?? null,
    };
  });

/**
 * Reads the facts of the given channels, fifty per request at 1 unit each. A
 * channel the API does not know is simply absent from the result; an entry
 * that cannot be read is absent and counted. A request that fails ends the
 * read and is reported in the result, with what was read before it.
 */
export async function fetchChannels(
  channelIds: readonly string[],
  options: DataApiOptions,
): Promise<ListResult<ChannelFacts>> {
  const ids = requireIds(channelIds, CHANNEL_ID_PATTERN, 'channel');
  return readInBatches(ids, channelSchema, (batch) => {
    const query = new URLSearchParams({
      part: 'snippet,statistics,contentDetails',
      id: batch.join(','),
    });
    return getPage('channels', query, CHANNELS_COST, options);
  });
}

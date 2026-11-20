/** videos.list: the facts and figures of videos, fifty to a request of 1 unit. */
import { z } from 'zod';
import { getPage, type Cost, type DataApiOptions } from './client';
import { parseIsoDuration } from './duration';
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from './ids';
import { count, readInBatches, requireIds, shortText, timestamp, type ListResult } from './parse';

const VIDEOS_COST: Cost = { kind: 'reading', units: 1 };

export interface VideoFacts {
  readonly id: string;
  readonly channelId: string;
  readonly title: string;
  /** The exact moment of publication. */
  readonly publishedAt: Date;
  /** Null for a live broadcast, which has no length yet, and for a length that cannot be read. */
  readonly durationSeconds: number | null;
  /** YouTube's numbered category, such as "26"; null when the reply gives none. */
  readonly categoryId: string | null;
  /** The language of the title and description, when the uploader set one. */
  readonly defaultLanguage: string | null;
  /** The spoken language, when the uploader set one. */
  readonly defaultAudioLanguage: string | null;
  /** Null when the uploader hides the view count. */
  readonly views: number | null;
}

/** A field the uploader may leave unset; one in a shape not expected reads as unset. */
const code = z.string().min(1).max(20).optional().catch(undefined);

/** A live broadcast is written as a length of nothing; that is "not known", not "zero seconds". */
const lengthOf = (text: string | undefined): number | null => {
  const seconds = text === undefined ? null : parseIsoDuration(text);
  return seconds === null || seconds === 0 ? null : seconds;
};

const videoSchema = z
  .object({
    id: z.string().regex(VIDEO_ID_PATTERN),
    snippet: z.object({
      channelId: z.string().regex(CHANNEL_ID_PATTERN),
      title: shortText,
      publishedAt: timestamp,
      categoryId: code,
      defaultLanguage: code,
      defaultAudioLanguage: code,
    }),
    contentDetails: z
      .object({ duration: z.string().optional().catch(undefined) })
      .optional()
      .catch(undefined),
    statistics: z
      .object({ viewCount: count.optional().catch(undefined) })
      .optional()
      .catch(undefined),
  })
  .transform(({ id, snippet, contentDetails, statistics }): VideoFacts => ({
    id,
    channelId: snippet.channelId,
    title: snippet.title,
    publishedAt: snippet.publishedAt,
    durationSeconds: lengthOf(contentDetails?.duration),
    categoryId: snippet.categoryId ?? null,
    defaultLanguage: snippet.defaultLanguage ?? null,
    defaultAudioLanguage: snippet.defaultAudioLanguage ?? null,
    views: statistics?.viewCount ?? null,
  }));

/**
 * Reads the facts of the given videos, fifty per request at 1 unit each. A
 * video the API does not know (deleted, private) is simply absent from the
 * result; an entry that cannot be read is absent and counted. A request that
 * fails ends the read and is reported in the result, with what was read before it.
 */
export async function fetchVideos(
  videoIds: readonly string[],
  options: DataApiOptions,
): Promise<ListResult<VideoFacts>> {
  const ids = requireIds(videoIds, VIDEO_ID_PATTERN, 'video');
  return readInBatches(ids, videoSchema, (batch) => {
    const query = new URLSearchParams({
      part: 'snippet,contentDetails,statistics',
      id: batch.join(','),
    });
    return getPage('videos', query, VIDEOS_COST, options);
  });
}

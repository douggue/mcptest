import { z } from 'zod';
import { QUICK_ANALYSIS_IDS } from './analyses';
import { MAX_NAMED_VIDEOS } from './answerEngine';
import type { AppOptions } from './app';
import { fail, ok } from './http';

/**
 * Reads of what an engine answered earlier, and of the videos an answer
 * names. Both read the store only.
 */

export const NAMED_VIDEOS_PATH = '/api/videos/named';

const CHANNEL_ID = /^UC[\w-]{22}$/;
const VIDEO_ID = /^[\w-]{11}$/;

const answerQuery = z.object({
  channel: z.string().regex(CHANNEL_ID),
  analysis: z.enum(QUICK_ANALYSIS_IDS),
});

const namedQuery = z.object({
  channel: z.string().regex(CHANNEL_ID),
  ids: z.array(z.string().regex(VIDEO_ID)).min(1).max(MAX_NAMED_VIDEOS),
  of: z.string().regex(CHANNEL_ID).optional(),
});

/**
 * The answer kept for a channel and one quick analysis. No answer yet is a
 * normal reply (`answer: null`), not a failure: most channels have none.
 */
export function readAnswer(options: AppOptions, url: URL): Response {
  const parsed = answerQuery.safeParse({
    channel: url.searchParams.get('channel'),
    analysis: url.searchParams.get('analysis'),
  });
  if (!parsed.success) {
    return fail(
      400,
      `Give the channel as a channel id and an analysis (${QUICK_ANALYSIS_IDS.join(', ')})`,
    );
  }
  const { analysis, channel } = parsed.data;
  return ok({ answer: options.engine.findAnswer(analysis, channel) });
}

/**
 * The stored videos of a channel's map among the ids given, so the page can
 * show the thumbnail of each video an AI's answer names. `of` adds one more
 * stored channel's videos, for an answer about a channel that was studied.
 * An id that is neither is simply not in the reply.
 */
export function readNamedVideos(options: AppOptions, url: URL): Response {
  const parsed = namedQuery.safeParse({
    channel: url.searchParams.get('channel'),
    ids: (url.searchParams.get('ids') ?? '').split(',').filter((id) => id !== ''),
    of: url.searchParams.get('of') ?? undefined,
  });
  if (!parsed.success) {
    return fail(400, `Give the channel as a channel id and 1 to ${MAX_NAMED_VIDEOS} video ids`);
  }
  const { channel, ids, of } = parsed.data;
  return ok({ videos: options.engine.namedVideos(channel, ids, of) });
}

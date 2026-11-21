import type { AnalysisAnswer, AnalysisId } from './analyses';
import { answerFrom, apiCaller, type Fetch } from './api';
import { MAX_NAMED_IDS, type NamedVideo } from './videoRefs';

/**
 * Reads of what an AI answered earlier for a channel, and of the stored
 * videos an answer names. Both read the store only and spend nothing.
 */

interface KeptReply {
  readonly answer: (Partial<AnalysisAnswer> & { readonly text: string }) | null;
}

export function createAnswersApi(fetcher?: Fetch) {
  const { call, unwrap } = apiCaller(fetcher);
  return {
    /** The answer kept for a channel and one quick analysis; null when there is none. */
    async keptAnswer(analysis: AnalysisId, channel: string): Promise<AnalysisAnswer | null> {
      const query = new URLSearchParams({ channel, analysis });
      const { answer } = unwrap<KeptReply>(await call(`/api/analyses?${query.toString()}`));
      return answer === null ? null : answerFrom(answer);
    },

    /**
     * The stored videos of a channel's map among these ids, and of `of` (a
     * channel that was broken down) when given. Ids that are neither are left out.
     */
    async namedVideos(
      channel: string,
      ids: readonly string[],
      of?: string,
    ): Promise<readonly NamedVideo[]> {
      if (ids.length === 0) return [];
      const query = new URLSearchParams({
        channel,
        ids: ids.slice(0, MAX_NAMED_IDS).join(','),
        ...(of === undefined ? {} : { of }),
      });
      const reply = unwrap<{ videos: readonly NamedVideo[] }>(
        await call(`/api/videos/named?${query.toString()}`),
      );
      return reply.videos;
    },
  };
}

export type AnswersApi = ReturnType<typeof createAnswersApi>;

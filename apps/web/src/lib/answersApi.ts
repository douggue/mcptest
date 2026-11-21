import type { AnalysisAnswer, AnalysisId } from './analyses';
import type { FlowCounts } from './flow';
import { answerFrom, apiCaller, type Fetch } from './api';
import { MAX_NAMED_IDS, type NamedVideo } from './videoRefs';

/**
 * Reads of what an AI answered earlier for a channel, and of the stored
 * videos an answer names. Both read the store only and spend nothing.
 */

/** The style lock kept for a channel, with the channel it was taken from. */
export interface StyleLockView {
  readonly channelId: string;
  readonly from: { readonly id: string; readonly title: string } | null;
  readonly text: string;
  readonly writtenAt: string;
}

interface KeptReply {
  readonly answer: (Partial<AnalysisAnswer> & { readonly text: string }) | null;
}

export function createAnswersApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  const of = (channel: string): string => `channel=${encodeURIComponent(channel)}`;
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

    /** How many of each thing are stored for the channel; null when it has no map. */
    async flow(channel: string): Promise<FlowCounts | null> {
      const envelope = await call(`/api/flow?${of(channel)}`);
      return envelope.status === 404 ? null : unwrap<FlowCounts>(envelope);
    },

    /** The style lock the owner uses for the channel; null when none. */
    async styleLock(channel: string): Promise<StyleLockView | null> {
      return unwrap<{ lock: StyleLockView | null }>(await call(`/api/style-lock?${of(channel)}`))
        .lock;
    },

    /** Uses the style lock of `from`'s breakdown for the channel. */
    async useStyleLock(channel: string, from: string): Promise<StyleLockView> {
      return unwrap<{ lock: StyleLockView }>(await send('/api/style-lock', { channel, from })).lock;
    },

    async stopStyleLock(channel: string): Promise<void> {
      unwrap<unknown>(await send('/api/style-lock/stop', { channel }));
    },
  };
}

export type AnswersApi = ReturnType<typeof createAnswersApi>;

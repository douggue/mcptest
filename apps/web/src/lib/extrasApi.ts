import type { SinceKind } from '@jgtube/core';
import { apiCaller, type Fetch } from './api';
import type { ChangesReply } from './changes';

/** The later features' part of the local server's API, each call for one channel by its id. */
export function createExtrasApi(fetcher?: Fetch) {
  const { call, unwrap, send } = apiCaller(fetcher);
  /** A read that answers 404 when the channel has no map. */
  const read = async <T>(path: string): Promise<T | null> => {
    const envelope = await call(path);
    return envelope.status === 404 ? null : unwrap<T>(envelope);
  };
  const of = (channel: string): string => `channel=${encodeURIComponent(channel)}`;

  return {
    /** What changed among a channel's look-alikes since a moment; null when it has no map. */
    changes: (channel: string, since: SinceKind) =>
      read<ChangesReply>(`/api/changes?${of(channel)}&since=${since}`),

    /** Moves the channel's last look to now; resolves with when that is. */
    async markSeen(channel: string): Promise<string> {
      return unwrap<{ lastLookAt: string }>(await send('/api/changes/seen', { channel }))
        .lastLookAt;
    },
  };
}

export type ExtrasApi = ReturnType<typeof createExtrasApi>;

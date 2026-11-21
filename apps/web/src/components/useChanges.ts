import type { SinceKind } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangesReply } from '../lib/changes';
import type { ExtrasApi } from '../lib/extrasApi';
import { requestCounter } from '../lib/requests';

export type ChangesState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly reply: ChangesReply; readonly problem: string | null }
  | { readonly status: 'failed'; readonly message: string };

const IDLE: ChangesState = { status: 'idle' };
const LOADING: ChangesState = { status: 'loading' };

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export interface Changes {
  readonly state: ChangesState;
  readonly since: SinceKind;
  readonly setSince: (since: SinceKind) => void;
  /** Moves the last look to now, then reads the comparison again. */
  readonly markSeen: () => void;
  /** Reads again, after a refresh has stored new readings. */
  readonly reload: () => void;
}

/**
 * What changed among the look-alikes of the channel on screen. It is read when
 * a map comes on screen, when the moment compared from changes and after a
 * refresh; what is shown stays up meanwhile so the page does not jump.
 */
export function useChanges(
  api: ExtrasApi,
  channelId: string | null,
  mapId: number | null,
): Changes {
  const [state, setState] = useState<ChangesState>(IDLE);
  const [since, setSince] = useState<SinceKind>('last-look');
  // Only the answer to the newest read is shown, so a slow older one cannot replace it.
  const requests = useMemo(() => requestCounter(), []);

  const read = useCallback(
    (isCurrent: () => boolean) => {
      if (channelId === null) return Promise.resolve();
      const isNewest = requests.begin();
      const wanted = (): boolean => isCurrent() && isNewest();
      return api
        .changes(channelId, since)
        .then((reply) => {
          if (wanted()) setState(reply ? { status: 'ready', reply, problem: null } : IDLE);
        })
        .catch((error: unknown) => {
          if (!wanted()) return;
          setState({ status: 'failed', message: messageOf(error, 'It could not be loaded') });
        });
    },
    [api, channelId, since, requests],
  );

  useEffect(() => {
    if (channelId === null) {
      setState(IDLE);
      return;
    }
    let current = true;
    setState((previous) =>
      previous.status === 'ready' && previous.reply.centerChannelId === channelId
        ? previous
        : LOADING,
    );
    void read(() => current);
    return () => {
      current = false;
    };
  }, [read, channelId, mapId]);

  const reload = useCallback(() => {
    void read(() => true);
  }, [read]);

  const markSeen = useCallback(() => {
    if (channelId === null) return;
    api
      .markSeen(channelId)
      .then(reload)
      .catch((error: unknown) =>
        setState((previous) =>
          previous.status === 'ready'
            ? { ...previous, problem: messageOf(error, 'It could not be marked as seen') }
            : previous,
        ),
      );
  }, [api, channelId, reload]);

  return { state, since, setSince, markSeen, reload };
}

import type { TransferList } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Api } from '../lib/api';
import { requestCounter } from '../lib/requests';
import { withSaved } from '../lib/transfers';

export type TransfersState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly list: TransferList;
      /** Set when the last save could not be stored. */
      readonly problem: string | null;
    }
  | { readonly status: 'failed'; readonly message: string };

const LOADING: TransfersState = { status: 'loading' };

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export interface Transfers {
  readonly state: TransfersState;
  readonly setSaved: (key: string, saved: boolean) => void;
  /** Reads the list again, after something else has changed the store. */
  readonly reload: () => void;
}

/**
 * The transfer list over the whole store, judged for the channel on screen.
 * It is read when the page opens and again when a different map is on screen.
 * The list already shown stays up meanwhile so the page does not jump.
 */
export function useTransfers(api: Api, channelId: string | null, mapId: number | null): Transfers {
  const [state, setState] = useState<TransfersState>(LOADING);

  // Only the answer to the newest read is shown, so a slow older one cannot replace it.
  const requests = useMemo(() => requestCounter(), []);
  const read = useCallback(
    (isCurrent: () => boolean) => {
      const isNewest = requests.begin();
      const stillWanted = (): boolean => isCurrent() && isNewest();
      return api
        .transfers(channelId)
        .then((list) => {
          if (stillWanted()) setState({ status: 'ready', list, problem: null });
        })
        .catch((error: unknown) => {
          if (!stillWanted()) return;
          setState({ status: 'failed', message: messageOf(error, 'The list could not be loaded') });
        });
    },
    [api, channelId, requests],
  );

  useEffect(() => {
    let current = true;
    setState((previous) => (previous.status === 'ready' ? previous : LOADING));
    void read(() => current);
    return () => {
      current = false;
    };
  }, [read, mapId]);

  const setSaved = useCallback(
    (key: string, saved: boolean) => {
      const settle = (change: (list: TransferList) => TransferList, problem: string | null) =>
        setState((previous) =>
          previous.status === 'ready'
            ? { ...previous, list: change(previous.list), problem }
            : previous,
        );
      api
        .setTransferSaved(key, saved)
        .then(() => settle((list) => withSaved(list, key, saved), null))
        .catch((error: unknown) =>
          settle((list) => list, messageOf(error, 'Your choice could not be saved')),
        );
    },
    [api],
  );

  const reload = useCallback(() => {
    void read(() => true);
  }, [read]);

  return { state, setSaved, reload };
}

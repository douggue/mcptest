import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Api } from '../lib/api';
import { requestCounter } from '../lib/requests';
import {
  createTransferPlaceApi,
  describeCountryRead,
  shouldReadCountries,
  type TransferReply,
} from '../lib/transferPlace';
import { withSaved } from '../lib/transfers';

export type TransfersState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly list: TransferReply;
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
  /** Stores the place the owner chose for the channel on screen (null removes it), then reads the list again. */
  readonly choosePlace: (placeKey: string | null) => void;
  /** What reading the missing countries did, in a sentence; null when nothing to say. */
  readonly countryNote: string | null;
  /** Reads the list again, after something else has changed the store. */
  readonly reload: () => void;
}

/**
 * The transfer list over the whole store, judged for the channel on screen.
 * It is read when the page opens and again when a different map is on screen.
 * The list already shown stays up meanwhile so the page does not jump.
 */
export function useTransfers(
  api: Api,
  channelId: string | null,
  mapId: number | null,
  /**
   * Read only once a screen that shows it has opened and the map on screen is
   * known, so the list is not read first for no channel and then for the one.
   */
  wanted = true,
): Transfers {
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
    if (!wanted) return undefined;
    let current = true;
    setState((previous) => (previous.status === 'ready' ? previous : LOADING));
    void read(() => current);
    return () => {
      current = false;
    };
  }, [read, mapId, wanted]);

  const setSaved = useCallback(
    (key: string, saved: boolean) => {
      const settle = (change: (list: TransferReply) => TransferReply, problem: string | null) =>
        setState((previous) =>
          previous.status === 'ready'
            ? { ...previous, list: change(previous.list), problem }
            : previous,
        );
      api
        .setTransferSaved(key, saved)
        .then(() => settle((list) => ({ ...list, ...withSaved(list, key, saved) }), null))
        .catch((error: unknown) =>
          settle((list) => list, messageOf(error, 'Your choice could not be saved')),
        );
    },
    [api],
  );

  const reload = useCallback(() => {
    if (wanted) void read(() => true);
  }, [read, wanted]);

  const placeApi = useMemo(() => createTransferPlaceApi(), []);
  const [countryNote, setCountryNote] = useState<string | null>(null);
  const choosePlace = useCallback(
    (placeKey: string | null) => {
      if (channelId === null) return;
      placeApi
        .setPlace(channelId, placeKey)
        .then(reload, (error: unknown) =>
          setState((previous) =>
            previous.status === 'ready'
              ? { ...previous, problem: messageOf(error, 'Your place could not be saved') }
              : previous,
          ),
        );
    },
    [channelId, placeApi, reload],
  );

  // The countries the list lacks are read once per channel when a key is set:
  // the channel's own, and those of the channels behind the listed ideas.
  const triedFor = useRef<string | null>(null);
  const list = state.status === 'ready' ? state.list : null;
  useEffect(() => {
    if (channelId === null || list === null) return;
    if (list.placeCheck.channelId !== channelId) return;
    if (!shouldReadCountries(list, triedFor.current === channelId)) return;
    triedFor.current = channelId;
    placeApi.readCountries(channelId).then(
      (outcome) => {
        setCountryNote(describeCountryRead(outcome));
        if (outcome.added > 0) reload();
      },
      (error: unknown) => setCountryNote(messageOf(error, 'The countries could not be read')),
    );
  }, [channelId, list, placeApi, reload]);
  useEffect(() => setCountryNote(null), [channelId]);

  return { state, setSaved, choosePlace, countryNote, reload };
}

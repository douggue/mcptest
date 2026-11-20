import type { NicheList } from '@jgtube/core';
import { useCallback, useEffect, useState } from 'react';
import type { Api } from '../lib/api';
import { withWatched } from '../lib/niches';

export type NichesState =
  | { readonly status: 'loading' }
  /** `problem` is set when the last watch choice could not be saved. */
  | { readonly status: 'ready'; readonly list: NicheList; readonly problem: string | null }
  | { readonly status: 'failed'; readonly message: string };

const LOADING: NichesState = { status: 'loading' };

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export interface Niches {
  readonly state: NichesState;
  readonly setWatched: (channelId: string, watched: boolean) => void;
}

/**
 * The niche list over the whole store. It is read when the page opens and
 * again when a different map is on screen, since a new map means new channels
 * were read. The list already shown stays up meanwhile so the page does not jump.
 */
export function useNiches(api: Api, mapId: number | null): Niches {
  const [state, setState] = useState<NichesState>(LOADING);

  useEffect(() => {
    let current = true;
    setState((previous) => (previous.status === 'ready' ? previous : LOADING));
    api
      .niches()
      .then((list) => {
        if (current) setState({ status: 'ready', list, problem: null });
      })
      .catch((error: unknown) => {
        if (!current) return;
        setState({
          status: 'failed',
          message: messageOf(error, 'The list could not be loaded'),
        });
      });
    return () => {
      current = false;
    };
  }, [api, mapId]);

  const setWatched = useCallback(
    (channelId: string, watched: boolean) => {
      const settle = (change: (list: NicheList) => NicheList, problem: string | null) =>
        setState((previous) =>
          previous.status === 'ready'
            ? { status: 'ready', list: change(previous.list), problem }
            : previous,
        );
      api
        .setNicheWatched(channelId, watched)
        .then(() => settle((list) => withWatched(list, channelId, watched), null))
        .catch((error: unknown) =>
          settle((list) => list, messageOf(error, 'Your choice could not be saved')),
        );
    },
    [api],
  );

  return { state, setWatched };
}

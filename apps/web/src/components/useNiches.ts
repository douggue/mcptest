import type { NicheList } from '@jgtube/core';
import { useCallback, useEffect, useState } from 'react';
import type { Api, SearchSummary } from '../lib/api';
import { withWatched } from '../lib/niches';

export type NichesState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly list: NicheList;
      /** Set when the last watch choice could not be saved. */
      readonly problem: string | null;
      /** Keyword search needs a YouTube API key; false when none is set. */
      readonly canDiscover: boolean;
    }
  | { readonly status: 'failed'; readonly message: string };

export type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly keyword: string }
  | { readonly status: 'done'; readonly summary: SearchSummary }
  | { readonly status: 'failed'; readonly message: string };

const LOADING: NichesState = { status: 'loading' };
const IDLE: SearchState = { status: 'idle' };

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export interface Niches {
  readonly state: NichesState;
  readonly setWatched: (channelId: string, watched: boolean) => void;
  readonly search: SearchState;
  /** Searches YouTube for a keyword, then shows the list with whatever it added. */
  readonly discover: (keyword: string) => void;
}

/**
 * The niche list over the whole store. It is read when the page opens and
 * again when a different map is on screen, since a new map means new channels
 * were read. The list already shown stays up meanwhile so the page does not jump.
 */
export function useNiches(api: Api, mapId: number | null): Niches {
  const [state, setState] = useState<NichesState>(LOADING);
  const [search, setSearch] = useState<SearchState>(IDLE);

  const read = useCallback(
    (isCurrent: () => boolean) =>
      api
        .niches()
        .then((reply) => {
          if (!isCurrent()) return;
          setState({ status: 'ready', list: reply, problem: null, canDiscover: reply.canDiscover });
        })
        .catch((error: unknown) => {
          if (!isCurrent()) return;
          setState({ status: 'failed', message: messageOf(error, 'The list could not be loaded') });
        }),
    [api],
  );

  useEffect(() => {
    let current = true;
    setState((previous) => (previous.status === 'ready' ? previous : LOADING));
    void read(() => current);
    return () => {
      current = false;
    };
  }, [read, mapId]);

  const setWatched = useCallback(
    (channelId: string, watched: boolean) => {
      const settle = (change: (list: NicheList) => NicheList, problem: string | null) =>
        setState((previous) =>
          previous.status === 'ready'
            ? { ...previous, list: change(previous.list), problem }
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

  const discover = useCallback(
    (keyword: string) => {
      setSearch({ status: 'running', keyword });
      api
        .discoverNiches(keyword)
        .then((summary) => {
          setSearch({ status: 'done', summary });
          return read(() => true);
        })
        .catch((error: unknown) =>
          setSearch({ status: 'failed', message: messageOf(error, 'The search did not finish') }),
        );
    },
    [api, read],
  );

  return { state, setWatched, search, discover };
}

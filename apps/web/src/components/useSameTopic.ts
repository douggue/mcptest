import type { MapSnapshot, SameTopicList } from '@jgtube/core';
import { useEffect, useState } from 'react';
import type { Api } from '../lib/api';

export type SameTopicState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly list: SameTopicList }
  | { readonly status: 'failed'; readonly message: string };

const IDLE: SameTopicState = { status: 'idle' };
const LOADING: SameTopicState = { status: 'loading' };

/**
 * The channels left out of the map on screen for their wording alone. It is
 * read again whenever the map is (a new map, a channel kept or let go), and the
 * list already shown stays up meanwhile so the page does not jump.
 */
export function useSameTopic(
  api: Api,
  snapshot: MapSnapshot | null,
  /** Read only once a screen that shows it has opened. */
  wanted = true,
): SameTopicState {
  const [state, setState] = useState<SameTopicState>(IDLE);
  const centerId = snapshot?.center.id ?? null;

  useEffect(() => {
    if (centerId === null) {
      setState(IDLE);
      return;
    }
    if (!wanted) return;
    let current = true;
    setState((previous) =>
      previous.status === 'ready' && previous.list.centerId === centerId ? previous : LOADING,
    );
    api
      .sameTopic(centerId)
      .then((list) => {
        if (current) setState(list ? { status: 'ready', list } : IDLE);
      })
      .catch((error: unknown) => {
        if (!current) return;
        const message = error instanceof Error ? error.message : 'The list could not be loaded';
        setState({ status: 'failed', message });
      });
    return () => {
      current = false;
    };
    // `snapshot` changes identity on every read of the map, which is when to read again.
  }, [api, centerId, snapshot, wanted]);

  return state;
}

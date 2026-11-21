import type { PacingView } from '@jgtube/core';
import { useEffect, useMemo, useState } from 'react';
import { createExtrasApi } from '../lib/extrasApi';
import { requestCounter } from '../lib/requests';

export type PacingState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly pacing: PacingView }
  | { readonly status: 'failed'; readonly message: string };

/** The channel on screen's lengths and pace against its map's breakouts; read again after each refresh. */
export function usePacing(channelId: string | null, reloadKey: unknown): PacingState {
  const api = useMemo(() => createExtrasApi(), []);
  const requests = useMemo(() => requestCounter(), []);
  const [state, setState] = useState<PacingState>({ status: 'idle' });

  useEffect(() => {
    if (channelId === null) {
      setState({ status: 'idle' });
      return;
    }
    const isNewest = requests.begin();
    setState((previous) =>
      previous.status === 'ready' && previous.pacing.centerChannelId === channelId
        ? previous
        : { status: 'loading' },
    );
    api
      .pacing(channelId)
      .then((pacing) => {
        if (isNewest()) setState(pacing ? { status: 'ready', pacing } : { status: 'idle' });
      })
      .catch((error: unknown) => {
        if (!isNewest()) return;
        setState({
          status: 'failed',
          message: error instanceof Error ? error.message : 'It could not be loaded',
        });
      });
  }, [api, requests, channelId, reloadKey]);

  return state;
}

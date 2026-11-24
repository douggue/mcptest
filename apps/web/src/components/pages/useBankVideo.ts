import type { BankCollection } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBankApi, type BankVideoLook } from '../../lib/bank';

export type BankVideoState =
  | { readonly status: 'loading' }
  /** `found` is null for a video the store does not hold, such as a file the owner gave. */
  | { readonly status: 'ready'; readonly found: BankVideoLook | null }
  | { readonly status: 'failed'; readonly message: string };

export interface BankVideoModel {
  readonly state: BankVideoState;
  /** Keeps a change to the collections the video is in, made on the page. */
  readonly setSaved: (collections: readonly BankCollection[], saved: readonly number[]) => void;
}

/** One stored video with its score and collections, read again when the store was refreshed. */
export function useBankVideo(videoId: string, reloadKey: string): BankVideoModel {
  const api = useMemo(() => createBankApi(), []);
  const [state, setState] = useState<BankVideoState>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    api.video(videoId).then(
      (found) => current && setState({ status: 'ready', found }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : 'The video could not be read';
        if (current) setState({ status: 'failed', message });
      },
    );
    return () => {
      current = false;
    };
  }, [api, videoId, reloadKey]);
  const setSaved = useCallback(
    (collections: readonly BankCollection[], saved: readonly number[]) =>
      setState((now) =>
        now.status === 'ready' && now.found
          ? { status: 'ready', found: { ...now.found, collections, saved } }
          : now,
      ),
    [],
  );
  return { state, setSaved };
}

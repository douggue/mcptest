import type { ChannelProfile } from '@jgtube/core';
import { useEffect, useMemo, useState } from 'react';
import { createExtrasApi } from '../lib/extrasApi';
import { messageOf } from './useMapPage';

export type ProfileState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly profile: ChannelProfile }
  | { readonly status: 'missing' }
  | { readonly status: 'failed'; readonly message: string };

/** One stored channel's profile, read again when the channel or `reloadKey` changes. */
export function useChannelProfile(channelId: string | null, reloadKey: string): ProfileState {
  const api = useMemo(() => createExtrasApi(), []);
  const [state, setState] = useState<ProfileState>({ status: 'loading' });
  useEffect(() => {
    if (channelId === null) return undefined;
    let current = true;
    setState({ status: 'loading' });
    api.profile(channelId).then(
      (profile) => {
        if (current) setState(profile ? { status: 'ready', profile } : { status: 'missing' });
      },
      (error: unknown) => {
        if (current) setState({ status: 'failed', message: messageOf(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [api, channelId, reloadKey]);
  return channelId === null ? { status: 'missing' } : state;
}

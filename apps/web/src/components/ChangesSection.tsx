import type { MapSnapshot } from '@jgtube/core';
import { useEffect, useMemo } from 'react';
import { createExtrasApi } from '../lib/extrasApi';
import { useChanges } from './useChanges';
import { WhatChanged } from './WhatChanged';

interface Props {
  /** The map on screen; without one there is nothing to compare. */
  readonly snapshot: MapSnapshot | null;
  /** Changes whenever a refresh ends, which is when to compare again. */
  readonly reloadKey: unknown;
}

/**
 * "What changed since you last looked", wired to the server for the channel
 * on screen. It keeps its own state, so the page mounts it in one line.
 */
export function ChangesSection({ snapshot, reloadKey }: Props) {
  const api = useMemo(() => createExtrasApi(), []);
  const changes = useChanges(api, snapshot?.center.id ?? null, snapshot?.mapId ?? null);
  const { reload } = changes;
  useEffect(reload, [reload, reloadKey]);
  if (!snapshot) return null;
  return <WhatChanged changes={changes} centerTitle={snapshot.center.title} />;
}

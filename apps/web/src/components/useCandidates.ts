import type { MapSnapshot } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChannelChoice } from '../lib/breakdown';
import {
  mergeCandidates,
  type Candidate,
  type CandidateFacts,
  type Closeness,
} from '../lib/breakdownPicks';
import { createBreakdownViewApi } from '../lib/videoBreakdown';

export type CandidatesState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly candidates: readonly Candidate[] }
  | { readonly status: 'failed'; readonly message: string };

export type PasteState =
  | { readonly status: 'idle' }
  | { readonly status: 'reading' }
  | { readonly status: 'read'; readonly candidate: CandidateFacts }
  | { readonly status: 'failed'; readonly message: string };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'That channel could not be read';

/** How close each channel on the map is to its centre. */
const closenessOf = (snapshot: MapSnapshot | null): ReadonlyMap<string, Closeness> =>
  new Map(snapshot?.channels.map((channel) => [channel.id, channel.tier]) ?? []);

/**
 * The channels the Breakdown view offers, each with what the server counted
 * from the store, and a pasted channel read once and added to them.
 * `extra` is a channel opened by its address that may not be on any list.
 */
export function useCandidates(
  choices: readonly ChannelChoice[],
  snapshot: MapSnapshot | null,
  extra: string | null,
) {
  const api = useMemo(() => createBreakdownViewApi(), []);
  const [facts, setFacts] = useState<readonly CandidateFacts[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pasted, setPasted] = useState<readonly CandidateFacts[]>([]);
  const [paste, setPaste] = useState<PasteState>({ status: 'idle' });
  const ids = useMemo(
    () => [...new Set([...choices.map((choice) => choice.id), ...(extra ? [extra] : [])])],
    [choices, extra],
  );
  const key = ids.join(',');

  useEffect(() => {
    let current = true;
    api
      .candidates(key === '' ? [] : key.split(','))
      .then((found) => current && setFacts(found))
      .catch((error: unknown) => current && setFailed(messageOf(error)));
    return () => {
      current = false;
    };
  }, [api, key]);

  const readChannel = useCallback(
    (channel: string) => {
      setPaste({ status: 'reading' });
      api
        .readChannel(channel)
        .then((candidate) => {
          setPasted((now) => [candidate, ...now.filter((entry) => entry.id !== candidate.id)]);
          setPaste({ status: 'read', candidate });
        })
        .catch((error: unknown) => setPaste({ status: 'failed', message: messageOf(error) }));
    },
    [api],
  );

  const state: CandidatesState = useMemo(() => {
    if (failed !== null) return { status: 'failed', message: failed };
    if (facts === null) return { status: 'loading' };
    const pastedChoices: ChannelChoice[] = pasted.map((entry) => ({
      id: entry.id,
      title: entry.title,
      label: entry.title,
      group: 'saved',
    }));
    const extraChoice: ChannelChoice[] =
      extra === null ? [] : [{ id: extra, title: '', label: '', group: 'saved' }];
    const all = [...choices, ...pastedChoices, ...extraChoice].filter(
      (choice, index, list) => list.findIndex((other) => other.id === choice.id) === index,
    );
    const merged = mergeCandidates(
      all,
      [...pasted, ...facts],
      closenessOf(snapshot),
      snapshot?.center.id ?? null,
    );
    // A channel opened by its address shows its own name, not the empty label above.
    return {
      status: 'ready',
      candidates: merged.map((entry) =>
        entry.label === '' ? { ...entry, label: entry.title } : entry,
      ),
    };
  }, [failed, facts, pasted, choices, extra, snapshot]);

  return { state, paste, readChannel };
}

import type { PlanView } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createExtrasApi } from '../lib/extrasApi';
import { requestCounter } from '../lib/requests';

export type PlanState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly plan: PlanView }
  | { readonly status: 'failed'; readonly message: string };

export interface Plan {
  readonly state: PlanState;
  /** A link is being checked, which may read the channel from YouTube once. */
  readonly linking: boolean;
  /** Why the last link or unlink was refused; null when it was not. */
  readonly problem: string | null;
  readonly link: (conceptId: number, link: string) => void;
  readonly unlink: (conceptId: number) => void;
}

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/** The channel on screen's own videos against the plan; read again after each refresh. */
export function usePlan(channelId: string | null, reloadKey: unknown): Plan {
  const api = useMemo(() => createExtrasApi(), []);
  const requests = useMemo(() => requestCounter(), []);
  const [state, setState] = useState<PlanState>({ status: 'idle' });
  const [linking, setLinking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setProblem(null);
    if (channelId === null) {
      setState({ status: 'idle' });
      return;
    }
    const isNewest = requests.begin();
    setState((previous) =>
      previous.status === 'ready' && previous.plan.centerChannelId === channelId
        ? previous
        : { status: 'loading' },
    );
    api
      .plan(channelId)
      .then((plan) => {
        if (isNewest()) setState(plan ? { status: 'ready', plan } : { status: 'idle' });
      })
      .catch((error: unknown) => {
        if (isNewest())
          setState({ status: 'failed', message: messageOf(error, 'It could not be loaded') });
      });
  }, [api, requests, channelId, reloadKey]);

  const write = useCallback(
    (work: Promise<PlanView>, fallback: string) => {
      const isNewest = requests.begin();
      setLinking(true);
      setProblem(null);
      work
        .then((plan) => {
          if (isNewest()) setState({ status: 'ready', plan });
        })
        .catch((error: unknown) => {
          if (isNewest()) setProblem(messageOf(error, fallback));
        })
        .finally(() => setLinking(false));
    },
    [requests],
  );

  const link = useCallback(
    (conceptId: number, text: string) => {
      if (channelId !== null)
        write(api.linkPlanVideo(channelId, conceptId, text), 'It could not be linked');
    },
    [api, channelId, write],
  );
  const unlink = useCallback(
    (conceptId: number) => {
      if (channelId !== null)
        write(api.unlinkPlanVideo(channelId, conceptId), 'It could not be unlinked');
    },
    [api, channelId, write],
  );

  return { state, linking, problem, link, unlink };
}

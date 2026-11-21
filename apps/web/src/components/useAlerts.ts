import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AlertSettingsInput, AlertsReply } from '../lib/alerts';
import { createExtrasApi } from '../lib/extrasApi';
import { requestCounter } from '../lib/requests';

export type AlertsState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly reply: AlertsReply; readonly problem: string | null }
  | { readonly status: 'failed'; readonly message: string };

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export interface Alerts {
  readonly state: AlertsState;
  readonly save: (settings: AlertSettingsInput) => void;
  readonly markRead: () => void;
}

/**
 * The alert rule and alerts of the channel on screen, read again whenever
 * `reloadKey` changes (a refresh has ended). `onChanged` is told after a save
 * or a read mark, so the chips' counts can follow.
 */
export function useAlerts(
  channelId: string | null,
  reloadKey: unknown,
  onChanged: () => void,
): Alerts {
  const api = useMemo(() => createExtrasApi(), []);
  const requests = useMemo(() => requestCounter(), []);
  const [state, setState] = useState<AlertsState>({ status: 'idle' });

  useEffect(() => {
    if (channelId === null) {
      setState({ status: 'idle' });
      return;
    }
    const isNewest = requests.begin();
    setState((previous) =>
      previous.status === 'ready' && previous.reply.centerChannelId === channelId
        ? previous
        : { status: 'loading' },
    );
    api
      .alerts(channelId)
      .then((reply) => {
        if (isNewest())
          setState(reply ? { status: 'ready', reply, problem: null } : { status: 'idle' });
      })
      .catch((error: unknown) => {
        if (isNewest())
          setState({ status: 'failed', message: messageOf(error, 'They could not be loaded') });
      });
  }, [api, requests, channelId, reloadKey]);

  const write = useCallback(
    (work: Promise<AlertsReply>, fallback: string) => {
      const isNewest = requests.begin();
      work
        .then((reply) => {
          if (isNewest()) setState({ status: 'ready', reply, problem: null });
          onChanged();
        })
        .catch((error: unknown) => {
          if (!isNewest()) return;
          setState((previous) =>
            previous.status === 'ready'
              ? { ...previous, problem: messageOf(error, fallback) }
              : previous,
          );
        });
    },
    [requests, onChanged],
  );

  const save = useCallback(
    (settings: AlertSettingsInput) => {
      if (channelId !== null)
        write(api.saveAlertRule(channelId, settings), 'The rule could not be saved');
    },
    [api, channelId, write],
  );
  const markRead = useCallback(() => {
    if (channelId !== null) write(api.markAlertsRead(channelId), 'They could not be marked read');
  }, [api, channelId, write]);

  return { state, save, markRead };
}

export interface AlertCounts {
  /** Unread alerts per saved channel. */
  readonly counts: Readonly<Record<string, number>>;
  readonly reload: () => void;
}

/** Unread alerts per saved channel, for the chips; read again after each refresh. */
export function useAlertCounts(reloadKey: unknown): AlertCounts {
  const api = useMemo(() => createExtrasApi(), []);
  const requests = useMemo(() => requestCounter(), []);
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    const isNewest = requests.begin();
    api
      .alertCounts()
      .then((found) => {
        if (isNewest()) setCounts(found);
      })
      // A badge is a convenience: without it the chips still work, and the section says why.
      .catch(() => {
        if (isNewest()) setCounts({});
      });
  }, [api, requests, reloadKey, turn]);

  const reload = useCallback(() => setTurn((value) => value + 1), []);
  return { counts, reload };
}

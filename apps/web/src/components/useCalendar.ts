import type { CalendarView, ScheduleEntry } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createExtrasApi } from '../lib/extrasApi';
import { requestCounter } from '../lib/requests';

export type CalendarState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly calendar: CalendarView }
  | { readonly status: 'failed'; readonly message: string };

export interface Calendar {
  readonly state: CalendarState;
  /** Why the last save was refused; null when it was not. */
  readonly problem: string | null;
  readonly save: (conceptId: number, entry: ScheduleEntry) => void;
}

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/** The channel on screen's upload calendar; read again when `reloadKey` changes. */
export function useCalendar(channelId: string | null, reloadKey: unknown): Calendar {
  const api = useMemo(() => createExtrasApi(), []);
  const requests = useMemo(() => requestCounter(), []);
  const [state, setState] = useState<CalendarState>({ status: 'idle' });
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setProblem(null);
    if (channelId === null) {
      setState({ status: 'idle' });
      return;
    }
    const isNewest = requests.begin();
    setState((previous) =>
      previous.status === 'ready' && previous.calendar.centerChannelId === channelId
        ? previous
        : { status: 'loading' },
    );
    api
      .calendar(channelId)
      .then((calendar) => {
        if (isNewest()) setState(calendar ? { status: 'ready', calendar } : { status: 'idle' });
      })
      .catch((error: unknown) => {
        if (isNewest())
          setState({ status: 'failed', message: messageOf(error, 'It could not be loaded') });
      });
  }, [api, requests, channelId, reloadKey]);

  const save = useCallback(
    (conceptId: number, entry: ScheduleEntry) => {
      if (channelId === null) return;
      const isNewest = requests.begin();
      setProblem(null);
      api
        .saveCalendarItem(channelId, conceptId, entry)
        .then((calendar) => {
          if (isNewest()) setState({ status: 'ready', calendar });
        })
        .catch((error: unknown) => {
          if (isNewest()) setProblem(messageOf(error, 'It could not be saved'));
        });
    },
    [api, requests, channelId],
  );

  return { state, problem, save };
}

import type { RefreshProgress } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Api, RefreshJobState, RefreshReply, RefreshSummary } from '../lib/api';
import { followJob, oneAtATime } from '../lib/requests';

const POLL_INTERVAL_MS = 1500;

export type RefreshView =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly reply: RefreshReply }
  | { readonly status: 'failed'; readonly message: string };

/** The refresh started from this page, or found running when it opened. */
export type RefreshRun =
  | { readonly status: 'idle' }
  | {
      readonly status: 'running';
      readonly jobId: string;
      readonly progress: RefreshProgress | null;
    }
  | { readonly status: 'done'; readonly summary: RefreshSummary }
  | { readonly status: 'failed'; readonly message: string };

const LOADING: RefreshView = { status: 'loading' };
const IDLE: RefreshRun = { status: 'idle' };

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export interface Refresh {
  readonly view: RefreshView;
  readonly run: RefreshRun;
  /** Starts a refresh; a press while one is being started is ignored. */
  readonly start: () => void;
}

/** What a reading of the refresh job means for the screen. */
function runFromJob(job: RefreshJobState): RefreshRun {
  if (job.status === 'done' && job.result) return { status: 'done', summary: job.result };
  if (job.status !== 'running') {
    return { status: 'failed', message: job.error ?? 'The refresh did not finish' };
  }
  return { status: 'running', jobId: job.id, progress: job.progress };
}

/**
 * Polls the refresh job while one runs, telling `onState` each state it is
 * seen in. Each reading waits for the last, and once a state other than
 * running has been told, nothing more is.
 */
function useFollowedJob(api: Api, jobId: string | null, onState: (next: RefreshRun) => void) {
  useEffect(() => {
    if (jobId === null) return;
    const tell = (next: RefreshRun): boolean => {
      onState(next);
      return next.status !== 'running';
    };
    return followJob({
      intervalMs: POLL_INTERVAL_MS,
      read: () => api.refreshJob(jobId),
      onReading: (job) => tell(runFromJob(job)),
      onLost: (error) =>
        tell({ status: 'failed', message: messageOf(error, 'The refresh was lost track of') }),
    });
  }, [api, jobId, onState]);
}

/**
 * When the stored channels were last read again, and the control that reads
 * them now. A refresh already running when the page opens (the timer's, or one
 * started before a reload) is picked up and followed. `onDone` is called when a
 * refresh ends, so lists built from the store can be read again.
 */
export function useRefresh(api: Api, onDone: () => void): Refresh {
  const [view, setView] = useState<RefreshView>(LOADING);
  const [run, setRun] = useState<RefreshRun>(IDLE);

  const readStatus = useCallback(
    (isCurrent: () => boolean = () => true) =>
      api
        .refreshStatus()
        .then((reply) => {
          if (!isCurrent()) return;
          setView({ status: 'ready', reply });
          if (reply.jobId !== null) {
            const { jobId } = reply;
            setRun((now) =>
              now.status === 'running' ? now : { status: 'running', jobId, progress: null },
            );
          }
        })
        .catch((error: unknown) => {
          if (!isCurrent()) return;
          setView({ status: 'failed', message: messageOf(error, 'The status could not be read') });
        }),
    [api],
  );

  useEffect(() => {
    let current = true;
    void readStatus(() => current);
    return () => {
      current = false;
    };
  }, [readStatus]);

  // While a refresh runs, follow it; when it ends, read the status and the lists again.
  const follow = useCallback(
    (next: RefreshRun) => {
      setRun(next);
      if (next.status === 'running') return;
      void readStatus();
      onDone();
    },
    [onDone, readStatus],
  );
  useFollowedJob(api, run.status === 'running' ? run.jobId : null, follow);

  // A second press while the first is still being sent does nothing. A refusal
  // never replaces a refresh this page is following: the server refuses a start
  // because one is running, and the status read picks that one up.
  const start = useMemo(
    () =>
      oneAtATime(() =>
        api.startRefresh().then(
          (id) => setRun({ status: 'running', jobId: id, progress: null }),
          (error: unknown) => {
            const message = messageOf(error, 'The refresh could not be started');
            setRun((now) => (now.status === 'running' ? now : { status: 'failed', message }));
            return readStatus();
          },
        ),
      ),
    [api, readStatus],
  );

  return { view, run, start };
}

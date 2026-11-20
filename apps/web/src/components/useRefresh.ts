import type { RefreshProgress } from '@jgtube/core';
import { useCallback, useEffect, useState } from 'react';
import type { Api, RefreshReply, RefreshSummary } from '../lib/api';

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
  readonly start: () => void;
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

  const jobId = run.status === 'running' ? run.jobId : null;
  // While a refresh runs, poll it; when it ends, read the status and the lists again.
  useEffect(() => {
    if (jobId === null) return;
    const finish = (next: RefreshRun) => {
      setRun(next);
      void readStatus();
      onDone();
    };
    const timer = window.setInterval(() => {
      api
        .refreshJob(jobId)
        .then((job) => {
          if (job.status === 'done' && job.result) finish({ status: 'done', summary: job.result });
          else if (job.status !== 'running') {
            finish({ status: 'failed', message: job.error ?? 'The refresh did not finish' });
          } else setRun({ status: 'running', jobId, progress: job.progress });
        })
        .catch((error: unknown) =>
          finish({ status: 'failed', message: messageOf(error, 'The refresh was lost track of') }),
        );
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [api, jobId, onDone, readStatus]);

  const start = useCallback(() => {
    api
      .startRefresh()
      .then((id) => setRun({ status: 'running', jobId: id, progress: null }))
      .catch((error: unknown) =>
        setRun({ status: 'failed', message: messageOf(error, 'The refresh could not be started') }),
      );
  }, [api]);

  return { view, run, start };
}

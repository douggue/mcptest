import { useCallback, useEffect, useState } from 'react';
import { followJob } from '../lib/requests';
import { createSweepApi, type SweepReply, type SweepResult } from '../lib/sweep';

const sweepApi = createSweepApi();
const POLL_MS = 2000;

export type SweepRun =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly step: string }
  | { readonly status: 'done'; readonly result: SweepResult }
  | { readonly status: 'failed'; readonly message: string };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface Sweep {
  /** Null until the watchlist has been read. */
  readonly info: SweepReply | null;
  /** Why the last change or start did not go through. */
  readonly problem: string | null;
  readonly run: SweepRun;
  readonly addKeyword: (keyword: string) => void;
  readonly changeKeyword: (action: 'remove' | 'pause' | 'resume', id: number) => void;
  readonly saveSettings: (everyDays: number | null, pageBudget: number) => void;
  readonly start: () => void;
}

/**
 * The watchlist and its sweep. A sweep runs in the server and is listed in
 * Working; this follows it, here or after a reload, and tells `onSwept` when
 * it ends so the list can be read again.
 */
export function useSweep(onSwept: () => void): Sweep {
  const [info, setInfo] = useState<SweepReply | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [run, setRun] = useState<SweepRun>({ status: 'idle' });
  const [jobId, setJobId] = useState<string | null>(null);

  const load = useCallback(() => {
    sweepApi.info().then(
      (found) => {
        setInfo(found);
        // A sweep under way when the page opens is picked up again.
        if (found.jobId) setJobId((current) => current ?? found.jobId);
      },
      (error: unknown) => setProblem(messageOf(error)),
    );
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (jobId === null) return undefined;
    setRun({ status: 'running', step: 'Starting' });
    return followJob({
      read: () => sweepApi.job(jobId),
      intervalMs: POLL_MS,
      onReading: (job) => {
        if (job.status === 'running') {
          setRun({ status: 'running', step: job.progress?.text ?? 'Starting' });
          return false;
        }
        setRun(
          job.status === 'done' && job.result
            ? { status: 'done', result: job.result }
            : { status: 'failed', message: job.error ?? 'The sweep did not finish.' },
        );
        setJobId(null);
        load();
        onSwept();
        return true;
      },
      onLost: (error) => setRun({ status: 'failed', message: messageOf(error) }),
    });
  }, [jobId, load, onSwept]);

  const settle = (change: Promise<SweepReply>): void => {
    change.then(
      (next) => {
        setInfo(next);
        setProblem(null);
      },
      (error: unknown) => setProblem(messageOf(error)),
    );
  };

  return {
    info,
    problem,
    run,
    addKeyword: (keyword) => settle(sweepApi.addKeyword(keyword)),
    changeKeyword: (action, id) => settle(sweepApi.changeKeyword(action, id)),
    saveSettings: (everyDays, pageBudget) =>
      settle(sweepApi.saveSettings({ everyDays, pageBudget })),
    start: () => {
      setProblem(null);
      sweepApi.start().then(setJobId, (error: unknown) => setProblem(messageOf(error)));
    },
  };
}

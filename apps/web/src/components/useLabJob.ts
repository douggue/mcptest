import { useCallback, useEffect, useRef, useState } from 'react';
import type { LabApi, LabOutcome } from '../lib/labApi';

/** What one job of the idea lab is, as the page names it. */
export type LabTask =
  | {
      readonly kind:
        | 'batch'
        | 'where-else'
        | 'formulas'
        | 'hooks-build'
        | 'hooks-label'
        | 'script-hooks'
        | 'script-draft'
        | 'script-tighten'
        | 'voice-read';
    }
  | { readonly kind: 'twist' | 'more' | 'thumbnail'; readonly conceptId: number };

export type LabJobState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'running';
      readonly task: LabTask;
      /** The step it is on, in plain words; null until the server has said. */
      readonly text: string | null;
    }
  | { readonly status: 'failed'; readonly task: LabTask; readonly message: string };

export interface LabJobs {
  readonly state: LabJobState;
  /**
   * Starts a job and hands its outcome to `onDone` when it finishes. Ignored
   * while another of the lab's jobs is running.
   */
  readonly run: (
    task: LabTask,
    start: () => Promise<string>,
    onDone: (outcome: LabOutcome) => void,
  ) => void;
}

const POLL_INTERVAL_MS = 1500;
const IDLE: LabJobState = { status: 'idle' };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'It could not finish';

/**
 * One job of the idea lab at a time. A job runs on the server for a minute
 * or several, so the page asks how it is going every second or two and
 * shows the step it is on.
 */
export function useLabJob(api: LabApi): LabJobs {
  const [state, setState] = useState<LabJobState>(IDLE);
  const [jobId, setJobId] = useState<string | null>(null);
  // Refs, not state: a second press must be refused before the screen has redrawn.
  const running = useRef(false);
  const done = useRef<(outcome: LabOutcome) => void>(() => undefined);

  useEffect(() => {
    if (jobId === null) return;
    const finish = (next: (task: LabTask) => LabJobState): void => {
      running.current = false;
      setJobId(null);
      setState((current) => (current.status === 'running' ? next(current.task) : current));
    };
    const timer = window.setInterval(() => {
      api
        .job(jobId)
        .then((job) => {
          if (job.status === 'done' && job.result) {
            done.current(job.result);
            finish(() => IDLE);
          } else if (job.status !== 'running') {
            const message = job.error ?? 'It could not finish';
            finish((task) => ({ status: 'failed', task, message }));
          } else {
            const text = job.progress?.text ?? null;
            setState((current) => (current.status === 'running' ? { ...current, text } : current));
          }
        })
        .catch((error: unknown) => {
          const message = messageOf(error);
          finish((task) => ({ status: 'failed', task, message }));
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [api, jobId]);

  const run = useCallback<LabJobs['run']>((task, start, onDone) => {
    if (running.current) return;
    running.current = true;
    done.current = onDone;
    setState({ status: 'running', task, text: null });
    start()
      .then(setJobId)
      .catch((error: unknown) => {
        running.current = false;
        setState({ status: 'failed', task, message: messageOf(error) });
      });
  }, []);

  return { state, run };
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IDLE_POLL_MS,
  NO_WATCH,
  createJobsApi,
  dismissNotice,
  pollDelay,
  watchStep,
  type JobEntry,
  type JobWatch,
} from '../lib/jobs';
import type { ViewId } from '../lib/routes';

/** How long after a press the list is read, so a run it started is on the server by then. */
const AFTER_PRESS_MS = 1500;

export interface JobWatchState {
  readonly jobs: readonly JobEntry[];
  readonly watch: JobWatch;
  readonly dismiss: (id: string) => void;
}

/**
 * The server's list of work, read every few seconds while something runs and
 * every half minute otherwise, and again whenever the window regains focus
 * or, shortly after, whenever the owner presses something (which may have
 * started a run).
 * A failed read keeps the last list and tries again on the slow beat.
 */
export function useJobWatch(active: ViewId): JobWatchState {
  const api = useMemo(() => createJobsApi(), []);
  const [jobs, setJobs] = useState<readonly JobEntry[]>([]);
  const [watch, setWatch] = useState<JobWatch>(NO_WATCH);

  useEffect(() => {
    let current = true;
    let timer: number | undefined;
    const read = (): void => {
      window.clearTimeout(timer);
      api
        .list()
        .then((found) => {
          if (!current) return;
          setJobs(found);
          timer = window.setTimeout(read, pollDelay(found));
        })
        .catch(() => {
          if (current) timer = window.setTimeout(read, IDLE_POLL_MS);
        });
    };
    const soon = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, AFTER_PRESS_MS);
    };
    read();
    window.addEventListener('focus', read);
    document.addEventListener('click', soon);
    return () => {
      current = false;
      window.clearTimeout(timer);
      window.removeEventListener('focus', read);
      document.removeEventListener('click', soon);
    };
  }, [api]);

  // Each new list, and each change of view: a job that ended elsewhere gains a "Done"
  // line, and opening a job's view clears its line at once.
  useEffect(() => setWatch((before) => watchStep(before, jobs, active)), [active, jobs]);

  const dismiss = useCallback((id: string) => setWatch((before) => dismissNotice(before, id)), []);
  return { jobs, watch, dismiss };
}

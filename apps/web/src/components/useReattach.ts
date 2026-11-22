import { useEffect, useMemo, useRef, useState } from 'react';
import { BUSY_POLL_MS, createJobsApi, findRunningJob, type JobEntry } from '../lib/jobs';

/**
 * When a view opens for a channel, asks the server whether a run of its own
 * is still under way (started before the owner went elsewhere) and hands it
 * to `attach`, so the view follows it again instead of showing nothing.
 * `kinds` must not change between renders: pass a constant.
 */
export function useReattach(
  kinds: readonly string[],
  channelId: string | null,
  attach: (job: JobEntry) => void,
): void {
  const api = useMemo(() => createJobsApi(), []);
  const latest = useRef(attach);
  latest.current = attach;

  useEffect(() => {
    if (channelId === null) return undefined;
    let current = true;
    void findRunningJob(api, kinds, { channelId }).then((job) => {
      if (current && job) latest.current(job);
    });
    return () => {
      current = false;
    };
  }, [api, kinds, channelId]);
}

/** A ref that is true while the component is on screen, for work that outlives it. */
export function useOnScreen(): { readonly current: boolean } {
  const onScreen = useRef(true);
  useEffect(() => {
    onScreen.current = true;
    return () => {
      onScreen.current = false;
    };
  }, []);
  return onScreen;
}

/**
 * A run of one of these kinds found under way when the view opened, watched
 * until it ends; null when there is none. For work a request waits on, such
 * as a picture check, whose answer reaches the app however the view is left.
 */
export function useRunningOnOpen(kinds: readonly string[]): JobEntry | null {
  const api = useMemo(() => createJobsApi(), []);
  const [job, setJob] = useState<JobEntry | null>(null);

  useEffect(() => {
    let current = true;
    let timer: number | undefined;
    const look = (): void => {
      void findRunningJob(api, kinds, {}).then((found) => {
        if (!current) return;
        setJob(found);
        if (found) timer = window.setTimeout(look, BUSY_POLL_MS);
      });
    };
    look();
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [api, kinds]);
  return job;
}

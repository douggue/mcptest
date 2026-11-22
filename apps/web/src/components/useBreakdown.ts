import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineChoice } from '../lib/analyses';
import type { Api } from '../lib/api';
import type { BreakdownOutcome, BreakdownProgress, VideoToSupply } from '../lib/breakdown';
import type { BreakdownView } from '../lib/breakdownParts';
import { createJobsApi, findRunningJob } from '../lib/jobs';

/** The kind of job a channel breakdown is listed under at GET /api/jobs. */
const BREAKDOWN_KINDS: readonly string[] = ['breakdown'];

/** The channel a breakdown is for, as the page names it. */
export interface BreakdownChannel {
  readonly id: string;
  readonly title: string;
}

export type BreakdownState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'running';
      readonly channel: BreakdownChannel;
      /** The step it is on; null until the server has said. */
      readonly progress: BreakdownProgress | null;
    }
  | {
      readonly status: 'done';
      readonly channel: BreakdownChannel;
      readonly outcome: BreakdownOutcome;
    }
  | {
      readonly status: 'failed';
      readonly channel: BreakdownChannel;
      readonly message: string;
      /** Videos found, before it failed, that the owner can supply a file for. */
      readonly supply: readonly VideoToSupply[];
    };

/** The breakdown the store holds for the channel that is picked. */
export type StoredBreakdown =
  | { readonly status: 'none' | 'loading' | 'absent' }
  | { readonly status: 'ready'; readonly view: BreakdownView }
  | { readonly status: 'failed'; readonly message: string };

export interface Breakdown {
  readonly state: BreakdownState;
  /** The channel picked for a breakdown; null until one is. */
  readonly picked: BreakdownChannel | null;
  /** Picks a channel, so that its stored breakdown is shown. */
  readonly pick: (channel: BreakdownChannel) => void;
  /** The stored breakdown of the picked channel, as far as it has been read. */
  readonly stored: StoredBreakdown;
  /** Starts a breakdown of a channel, and picks it. Ignored while one is running. */
  readonly start: (channel: BreakdownChannel, choice: EngineChoice, fresh: boolean) => void;
}

const POLL_INTERVAL_MS = 1500;
const IDLE: BreakdownState = { status: 'idle' };
const NONE: StoredBreakdown = { status: 'none' };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'The breakdown could not finish';

/**
 * The stored breakdown of the picked channel, read again whenever the pick
 * changes or a run ends (`version` counts the runs that have ended).
 */
function useStored(api: Api, picked: BreakdownChannel | null, version: number): StoredBreakdown {
  const [stored, setStored] = useState<StoredBreakdown>(NONE);
  const pickedId = picked?.id ?? null;
  useEffect(() => {
    if (pickedId === null) {
      setStored(NONE);
      return;
    }
    let current = true;
    setStored({ status: 'loading' });
    api
      .storedBreakdown(pickedId)
      .then((view) => {
        if (current) setStored(view === null ? { status: 'absent' } : { status: 'ready', view });
      })
      .catch((error: unknown) => {
        if (current) setStored({ status: 'failed', message: messageOf(error) });
      });
    return () => {
      current = false;
    };
  }, [api, pickedId, version]);
  return stored;
}

/**
 * One breakdown at a time. It runs as a job on the server for many minutes,
 * so the page asks how it is going every second or two and shows the step.
 * The last outcome stays on screen until the next breakdown is started or
 * another channel is picked; a finished breakdown is kept by the server and
 * is shown again when its channel is picked.
 */
export function useBreakdown(api: Api): Breakdown {
  const [state, setState] = useState<BreakdownState>(IDLE);
  const [jobId, setJobId] = useState<string | null>(null);
  const [picked, setPicked] = useState<BreakdownChannel | null>(null);
  const [ended, setEnded] = useState(0);
  // A ref, not state: a second press must be refused before the screen has redrawn.
  const running = useRef(false);
  const stored = useStored(api, picked, ended);

  // A breakdown started before a reload runs on in the server: follow it again.
  useEffect(() => {
    let current = true;
    void findRunningJob(createJobsApi(), BREAKDOWN_KINDS, {}).then((job) => {
      if (!current || job === null || job.channelId === null || running.current) return;
      running.current = true;
      const channel = { id: job.channelId, title: job.title.replace(/^Breaking down /, '') };
      setPicked(channel);
      setState({ status: 'running', channel, progress: null });
      setJobId(job.id);
    });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (jobId === null) return;
    const finish = (next: (channel: BreakdownChannel) => BreakdownState): void => {
      running.current = false;
      setJobId(null);
      setEnded((count) => count + 1);
      setState((current) => (current.status === 'running' ? next(current.channel) : current));
    };
    const timer = window.setInterval(() => {
      api
        .breakdownJob(jobId)
        .then((job) => {
          if (job.status === 'done' && job.result) {
            const outcome = job.result;
            finish((channel) => ({ status: 'done', channel, outcome }));
          } else if (job.status !== 'running') {
            const message = job.error ?? 'The breakdown could not finish';
            const supply = job.progress?.supply ?? [];
            finish((channel) => ({ status: 'failed', channel, message, supply }));
          } else {
            setState((current) =>
              current.status === 'running' ? { ...current, progress: job.progress } : current,
            );
          }
        })
        .catch((error: unknown) => {
          const message = messageOf(error);
          finish((channel) => ({ status: 'failed', channel, message, supply: [] }));
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [api, jobId]);

  const pick = useCallback((channel: BreakdownChannel) => {
    setPicked((current) => (current?.id === channel.id ? current : channel));
  }, []);

  const start = useCallback(
    (channel: BreakdownChannel, choice: EngineChoice, fresh: boolean) => {
      if (running.current) return;
      running.current = true;
      pick(channel);
      setState({ status: 'running', channel, progress: null });
      api
        .startBreakdown(channel.id, choice, fresh)
        .then(setJobId)
        .catch((error: unknown) => {
          running.current = false;
          setState({ status: 'failed', channel, message: messageOf(error), supply: [] });
        });
    },
    [api, pick],
  );

  return { state, picked, pick, stored, start };
}

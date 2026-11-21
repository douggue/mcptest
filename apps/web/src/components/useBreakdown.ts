import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineChoice } from '../lib/analyses';
import type { Api } from '../lib/api';
import type { BreakdownOutcome, BreakdownProgress, VideoToSupply } from '../lib/breakdown';

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

export interface Breakdown {
  readonly state: BreakdownState;
  /** Starts a breakdown of a channel. Ignored while one is running. */
  readonly start: (channel: BreakdownChannel, choice: EngineChoice, fresh: boolean) => void;
}

const POLL_INTERVAL_MS = 1500;
const IDLE: BreakdownState = { status: 'idle' };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'The breakdown could not finish';

/**
 * One breakdown at a time. It runs as a job on the server for many minutes,
 * so the page asks how it is going every second or two and shows the step.
 * The last outcome stays on screen until the next breakdown is started.
 */
export function useBreakdown(api: Api): Breakdown {
  const [state, setState] = useState<BreakdownState>(IDLE);
  const [jobId, setJobId] = useState<string | null>(null);
  // A ref, not state: a second press must be refused before the screen has redrawn.
  const running = useRef(false);

  useEffect(() => {
    if (jobId === null) return;
    const finish = (next: (channel: BreakdownChannel) => BreakdownState): void => {
      running.current = false;
      setJobId(null);
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

  const start = useCallback(
    (channel: BreakdownChannel, choice: EngineChoice, fresh: boolean) => {
      if (running.current) return;
      running.current = true;
      setState({ status: 'running', channel, progress: null });
      api
        .startBreakdown(channel.id, choice, fresh)
        .then(setJobId)
        .catch((error: unknown) => {
          running.current = false;
          setState({ status: 'failed', channel, message: messageOf(error), supply: [] });
        });
    },
    [api],
  );

  return { state, start };
}

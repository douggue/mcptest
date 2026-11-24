import type { FormatChange } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createJobsApi, findRunningJob } from '../lib/jobs';
import { MIX_JOB_KIND, createFormatBuilderApi, type FormatView } from '../lib/formatBuilder';

export type FormatsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly formats: readonly FormatView[] }
  | { readonly status: 'failed'; readonly message: string };

export type MixState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly text: string | null }
  | { readonly status: 'failed'; readonly message: string };

export interface FormatBuilder {
  readonly state: FormatsState;
  readonly chosen: FormatView | null;
  readonly choose: (id: number) => void;
  readonly create: (name: string, targetSeconds: number | null) => Promise<string | null>;
  readonly change: (change: FormatChange) => Promise<string | null>;
  readonly duplicate: () => void;
  readonly remove: () => void;
  readonly mix: MixState;
  readonly suggest: (channel: string | null, engine: string | null) => void;
  /** The last problem with a change, in plain words; null when there is none. */
  readonly problem: string | null;
}

const POLL_MS = 1500;
const KINDS = [MIX_JOB_KIND];
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Follows one "Suggest a mix" job until it ends, then hands back the format it changed. */
function useMixJob(
  api: ReturnType<typeof createFormatBuilderApi>,
  onDone: (view: FormatView) => void,
) {
  const [mix, setMix] = useState<MixState>({ status: 'idle' });
  const [jobId, setJobId] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let current = true;
    void findRunningJob(createJobsApi(), KINDS, {}).then((job) => {
      if (current && job) {
        setMix({ status: 'running', text: job.progress });
        setJobId(job.id);
      }
    });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (jobId === null) return undefined;
    const timer = window.setInterval(() => {
      api.job(jobId).then(
        (job) => {
          if (job.status === 'running') {
            setMix({ status: 'running', text: job.progress?.text ?? null });
            return;
          }
          setJobId(null);
          if (job.status === 'done' && job.result) {
            setMix({ status: 'idle' });
            done.current(job.result);
          } else setMix({ status: 'failed', message: job.error ?? 'It could not finish.' });
        },
        (error: unknown) => {
          setJobId(null);
          setMix({ status: 'failed', message: messageOf(error) });
        },
      );
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [api, jobId]);
  const start = useCallback((begin: () => Promise<string>) => {
    setMix({ status: 'running', text: null });
    begin().then(setJobId, (error: unknown) =>
      setMix({ status: 'failed', message: messageOf(error) }),
    );
  }, []);
  return { mix, start };
}

/**
 * The owner's formats, read when the view opens and again when the shelf
 * changes (the checks rest on it), with the one being built and its changes.
 */
export function useFormatBuilder(shelfKey: string): FormatBuilder {
  const api = useMemo(() => createFormatBuilderApi(), []);
  const [state, setState] = useState<FormatsState>({ status: 'loading' });
  const [chosenId, setChosenId] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let current = true;
    api.list().then(
      (formats) => current && setState({ status: 'ready', formats }),
      (error: unknown) => current && setState({ status: 'failed', message: messageOf(error) }),
    );
    return () => {
      current = false;
    };
  }, [api, version, shelfKey]);

  const formats = state.status === 'ready' ? state.formats : [];
  const chosen = formats.find((one) => one.id === chosenId) ?? formats[0] ?? null;
  const replace = useCallback((view: FormatView) => {
    setChosenId(view.id);
    setState((current) =>
      current.status !== 'ready'
        ? current
        : {
            status: 'ready',
            formats: [view, ...current.formats.filter((one) => one.id !== view.id)],
          },
    );
  }, []);
  const { mix, start } = useMixJob(api, replace);
  const attempt = useCallback(
    async (work: () => Promise<FormatView>): Promise<string | null> => {
      try {
        replace(await work());
        setProblem(null);
        return null;
      } catch (error) {
        setProblem(messageOf(error));
        return messageOf(error);
      }
    },
    [replace],
  );
  const id = chosen?.id ?? null;
  return {
    state,
    chosen,
    choose: setChosenId,
    problem,
    mix,
    create: (name, targetSeconds) => attempt(() => api.create(name, targetSeconds)),
    change: (change) =>
      id === null ? Promise.resolve(null) : attempt(() => api.update(id, change)),
    duplicate: () => void (id !== null && attempt(() => api.duplicate(id))),
    remove: () => {
      if (id === null) return;
      api.remove(id).then(
        () => {
          setChosenId(null);
          reload();
        },
        (error: unknown) => setProblem(messageOf(error)),
      );
    },
    suggest: (channel, engine) => {
      if (id !== null) start(() => api.suggest(id, channel, engine));
    },
  };
}

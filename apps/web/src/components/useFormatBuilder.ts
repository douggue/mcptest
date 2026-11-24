import type { FormatChange } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createJobsApi, findRunningJob } from '../lib/jobs';
import {
  BIBLE_JOB_KIND,
  MIX_JOB_KIND,
  createFormatBuilderApi,
  type FormatView,
} from '../lib/formatBuilder';

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
  /** "Write my Format Bible", followed like "Suggest a mix". */
  readonly bible: MixState;
  readonly writeBible: (channel: string | null, engine: string | null) => void;
  /** Whether a map is open, so the chosen format can be made its channel's active one. */
  readonly canActivate: boolean;
  /** Makes the chosen format the channel's active one (true), or the channel's format none (false). */
  readonly setActive: (on: boolean) => void;
  /** The last problem with a change, in plain words; null when there is none. */
  readonly problem: string | null;
}

const POLL_MS = 1500;
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Follows one job of a kind (found again after a reload) until it ends, then hands back the format. */
function useFormatJob(
  api: ReturnType<typeof createFormatBuilderApi>,
  kind: string,
  onDone: (view: FormatView) => void,
) {
  const [mix, setMix] = useState<MixState>({ status: 'idle' });
  const [jobId, setJobId] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let current = true;
    void findRunningJob(createJobsApi(), [kind], {}).then((job) => {
      if (current && job) {
        setMix({ status: 'running', text: job.progress });
        setJobId(job.id);
      }
    });
    return () => {
      current = false;
    };
  }, [kind]);
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
export function useFormatBuilder(shelfKey: string, channelId: string | null): FormatBuilder {
  const api = useMemo(() => createFormatBuilderApi(), []);
  const [state, setState] = useState<FormatsState>({ status: 'loading' });
  const [chosenId, setChosenId] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let current = true;
    api.list(channelId).then(
      (formats) => current && setState({ status: 'ready', formats }),
      (error: unknown) => current && setState({ status: 'failed', message: messageOf(error) }),
    );
    return () => {
      current = false;
    };
  }, [api, version, shelfKey, channelId]);

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
  const { mix, start } = useFormatJob(api, MIX_JOB_KIND, replace);
  const { mix: bible, start: startBible } = useFormatJob(api, BIBLE_JOB_KIND, replace);
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
    create: (name, targetSeconds) => attempt(() => api.create(name, targetSeconds, channelId)),
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
    canActivate: channelId !== null,
    setActive: (on) => {
      if (channelId === null || id === null) return;
      api.setActive(channelId, on ? id : null).then(
        (formats) => {
          setState({ status: 'ready', formats });
          setProblem(null);
        },
        (error: unknown) => setProblem(messageOf(error)),
      );
    },
    suggest: (channel, engine) => {
      if (id !== null) start(() => api.suggest(id, channel, engine));
    },
    bible,
    writeBible: (channel, engine) => {
      if (id !== null) startBible(() => api.writeBible(id, channel, engine));
    },
  };
}

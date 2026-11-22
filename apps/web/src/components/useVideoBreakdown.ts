import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EngineChoice } from '../lib/analyses';
import { createJobsApi, findRunningJob } from '../lib/jobs';
import { uploadBreakdownFile } from '../lib/upload';
import {
  createBreakdownViewApi,
  fileType,
  videoIdFrom,
  type VideoBreakdownSummary,
  type VideoBreakdownView,
} from '../lib/videoBreakdown';

export type VideoRun =
  | { readonly status: 'idle' }
  | { readonly status: 'sending'; readonly fraction: number; readonly name: string }
  | {
      readonly status: 'running';
      readonly jobId: string;
      readonly label: string;
      readonly step: string | null;
    }
  | { readonly status: 'failed'; readonly message: string };

export interface VideoBreakdown {
  readonly run: VideoRun;
  /** The breakdowns kept, the newest first; null until read. */
  readonly kept: readonly VideoBreakdownSummary[] | null;
  /** The breakdown on screen; null when none is open. */
  readonly open: VideoBreakdownView | null;
  readonly openVideo: (videoId: string) => void;
  readonly fromLink: (link: string, choice: EngineChoice, fresh: boolean) => void;
  readonly fromFile: (file: File, choice: EngineChoice) => void;
}

const POLL_MS = 2000;
const KINDS: readonly string[] = ['video-breakdown'];
const IDLE: VideoRun = { status: 'idle' };
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'The breakdown could not finish';

/**
 * One deep breakdown of a video at a time. It runs as a job on the server
 * for minutes; the page follows it, and when the page is opened again while
 * one runs (after a reload), it finds it in the list of work and follows it
 * again. Held by the workspace, so switching views does not lose it.
 */
export function useVideoBreakdown(): VideoBreakdown {
  const api = useMemo(() => createBreakdownViewApi(), []);
  const [run, setRun] = useState<VideoRun>(IDLE);
  const [kept, setKept] = useState<readonly VideoBreakdownSummary[] | null>(null);
  const [open, setOpen] = useState<VideoBreakdownView | null>(null);
  const [version, setVersion] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    let current = true;
    api
      .videoBreakdowns()
      .then((items) => current && setKept(items))
      .catch(() => current && setKept([]));
    return () => {
      current = false;
    };
  }, [api, version]);

  const openVideo = useCallback(
    (videoId: string) => {
      api
        .videoBreakdown(videoId)
        .then(setOpen)
        .catch((error: unknown) => setRun({ status: 'failed', message: messageOf(error) }));
    },
    [api],
  );

  const follow = useCallback((jobId: string, label: string) => {
    busy.current = true;
    setRun({ status: 'running', jobId, label, step: null });
  }, []);

  // A run started before a reload goes on in the server: follow it again.
  useEffect(() => {
    let current = true;
    void findRunningJob(createJobsApi(), KINDS, {}).then((job) => {
      if (current && job !== null && !busy.current) follow(job.id, job.title);
    });
    return () => {
      current = false;
    };
  }, [follow]);

  const jobId = run.status === 'running' ? run.jobId : null;
  useEffect(() => {
    if (jobId === null) return undefined;
    const timer = window.setInterval(() => {
      const end = (next: VideoRun, view: VideoBreakdownView | null): void => {
        busy.current = false;
        setRun(next);
        if (view) setOpen(view);
        setVersion((count) => count + 1);
      };
      api
        .job(jobId)
        .then((job) => {
          if (job.status === 'done' && job.result) end(IDLE, job.result);
          else if (job.status !== 'running') {
            end({ status: 'failed', message: job.error ?? 'The breakdown could not finish' }, null);
          } else {
            const step = job.progress?.text ?? null;
            setRun((now) => (now.status === 'running' ? { ...now, step } : now));
          }
        })
        .catch((error: unknown) => end({ status: 'failed', message: messageOf(error) }, null));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [api, jobId]);

  const fromLink = useCallback(
    (link: string, choice: EngineChoice, fresh: boolean) => {
      const video = videoIdFrom(link);
      if (busy.current || video === null) return;
      busy.current = true;
      api
        .startVideo({ video }, choice, fresh)
        .then((started) => follow(started.jobId, 'Breaking down the video'))
        .catch((error: unknown) => {
          busy.current = false;
          setRun({ status: 'failed', message: messageOf(error) });
        });
    },
    [api, follow],
  );

  const fromFile = useCallback(
    (file: File, choice: EngineChoice) => {
      const type = fileType(file);
      if (busy.current || type === null) return;
      busy.current = true;
      setRun({ status: 'sending', fraction: 0, name: file.name });
      uploadBreakdownFile(file, type, (fraction) =>
        setRun({ status: 'sending', fraction, name: file.name }),
      )
        .then((saved) => api.startVideo({ file: saved.file, name: file.name }, choice, false))
        .then((started) => follow(started.jobId, `Breaking down ${file.name}`))
        .catch((error: unknown) => {
          busy.current = false;
          setRun({ status: 'failed', message: messageOf(error) });
        });
    },
    [api, follow],
  );

  return { run, kept, open, openVideo, fromLink, fromFile };
}

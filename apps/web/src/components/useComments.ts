import { useCallback, useEffect, useMemo, useState } from 'react';
import { readOutcomeLine, type CommentsView } from '../lib/comments';
import { createExtrasApi, type ExtrasApi, type ExtrasJob } from '../lib/extrasApi';
import { requestCounter } from '../lib/requests';

const POLL_MS = 1500;

export type Work =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly text: string }
  | { readonly status: 'done'; readonly text: string }
  | { readonly status: 'failed'; readonly text: string };

export interface Comments {
  readonly view: CommentsView | null;
  readonly problem: string | null;
  readonly work: Work;
  readonly read: (videoIds: readonly string[]) => void;
  readonly ask: (videoIds: readonly string[]) => void;
}

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/** What a finished job comes to, in a sentence. */
function doneText(job: ExtrasJob): string {
  if (job.result?.kind === 'comments-read') return readOutcomeLine(job.result.outcomes);
  if (job.result?.kind === 'viewer-answer') {
    const { proposed, dropped } = job.result.outcome;
    return `The AI gave ${proposed} findings; ${dropped} were dropped for resting on fewer than two of the comments handed out.`;
  }
  return 'Done.';
}

/** Polls a job until it ends. */
async function follow(
  api: ExtrasApi,
  id: string,
  onText: (text: string) => void,
): Promise<ExtrasJob> {
  for (;;) {
    const job = await api.extrasJob(id);
    if (job.status !== 'running') return job;
    onText(job.progress?.text ?? 'Working');
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** Comment mining for the channel on screen; read again after each refresh and each job. */
export function useComments(channelId: string | null, reloadKey: unknown): Comments {
  const api = useMemo(() => createExtrasApi(), []);
  const requests = useMemo(() => requestCounter(), []);
  const [view, setView] = useState<CommentsView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [work, setWork] = useState<Work>({ status: 'idle' });
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    if (channelId === null) {
      setView(null);
      return;
    }
    const isNewest = requests.begin();
    api
      .comments(channelId)
      .then((found) => {
        if (isNewest()) setView(found);
      })
      .catch((error: unknown) => {
        if (isNewest()) setProblem(messageOf(error, 'It could not be loaded'));
      });
  }, [api, requests, channelId, reloadKey, turn]);

  const run = useCallback(
    (start: () => Promise<string>) => {
      setWork({ status: 'running', text: 'Starting' });
      start()
        .then((id) => follow(api, id, (text) => setWork({ status: 'running', text })))
        .then((job) =>
          setWork(
            job.status === 'done'
              ? { status: 'done', text: doneText(job) }
              : { status: 'failed', text: job.error ?? 'It did not finish' },
          ),
        )
        .catch((error: unknown) =>
          setWork({ status: 'failed', text: messageOf(error, 'It could not start') }),
        )
        .finally(() => setTurn((value) => value + 1));
    },
    [api],
  );

  const read = useCallback(
    (videoIds: readonly string[]) => {
      if (channelId !== null) run(() => api.readComments(channelId, videoIds));
    },
    [api, channelId, run],
  );
  const ask = useCallback(
    (videoIds: readonly string[]) => {
      if (channelId !== null) run(() => api.askViewers(channelId, videoIds));
    },
    [api, channelId, run],
  );

  return { view, problem, work, read, ask };
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EngineChoice } from '../lib/analyses';
import { createOwnQuestionApi, type OwnAnswer } from '../lib/ownQuestion';

export type OwnQuestionState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly question: string }
  | { readonly status: 'failed'; readonly question: string; readonly message: string };

export interface OwnQuestion {
  readonly state: OwnQuestionState;
  /** The last question asked about the channel and its answer; null when none. */
  readonly answer: OwnAnswer | null;
  readonly ask: (question: string, choice: EngineChoice) => void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'The question was not answered';

/**
 * The owner's own question about the channel on screen: the last one asked
 * and its kept answer, read when the channel changes, and asking a new one.
 */
export function useOwnQuestion(centerId: string): OwnQuestion {
  const api = useMemo(() => createOwnQuestionApi(), []);
  const [state, setState] = useState<OwnQuestionState>({ status: 'idle' });
  const [answer, setAnswer] = useState<OwnAnswer | null>(null);

  useEffect(() => {
    let current = true;
    setAnswer(null);
    api.kept(centerId).then(
      (kept) => {
        if (current) setAnswer(kept);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [api, centerId]);

  const ask = useCallback(
    (question: string, choice: EngineChoice) => {
      setState({ status: 'running', question });
      api.ask(centerId, question, choice).then(
        (answered) => {
          setAnswer(answered);
          setState({ status: 'idle' });
        },
        (error: unknown) => setState({ status: 'failed', question, message: messageOf(error) }),
      );
    },
    [api, centerId],
  );

  return { state, answer, ask };
}

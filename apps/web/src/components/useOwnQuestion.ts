import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EngineChoice } from '../lib/analyses';
import type { AskAbout } from '../lib/askContext';
import { createOwnQuestionApi, type OwnAnswer } from '../lib/ownQuestion';

export type OwnQuestionState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly question: string }
  | { readonly status: 'failed'; readonly question: string; readonly message: string };

export interface OwnQuestion {
  readonly state: OwnQuestionState;
  /** The last question asked about the channel and its answer; null when none. */
  readonly answer: OwnAnswer | null;
  /** Asks a question; `about` is the channel or video on screen, when there is one. */
  readonly ask: (question: string, choice: EngineChoice, about?: AskAbout) => void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'The question was not answered';

/**
 * The owner's own question about the channel on screen: the last one asked
 * and its kept answer, read when the channel changes, and asking a new one.
 * With no channel yet there is nothing to read or ask.
 */
export function useOwnQuestion(centerId: string | null): OwnQuestion {
  const api = useMemo(() => createOwnQuestionApi(), []);
  const [state, setState] = useState<OwnQuestionState>({ status: 'idle' });
  const [answer, setAnswer] = useState<OwnAnswer | null>(null);

  useEffect(() => {
    let current = true;
    setAnswer(null);
    if (centerId === null) return undefined;
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
    (question: string, choice: EngineChoice, about?: AskAbout) => {
      if (centerId === null) return;
      setState({ status: 'running', question });
      api.ask(centerId, question, choice, about).then(
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

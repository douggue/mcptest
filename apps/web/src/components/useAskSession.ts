import { useCallback, useState } from 'react';
import type { AskAbout } from '../lib/askContext';
import { choiceFor, latestKept, type AnalysisId, type KeptAnswer } from '../lib/analyses';
import type { Analysis } from './useAnalysis';
import { useKeptAnswers } from './useAnswers';
import { useOwnQuestion, type OwnQuestion } from './useOwnQuestion';

/** What the answer area shows: the owner's own question, or one of the quick ones. */
export type ShownAnswer = AnalysisId | 'own';

/**
 * One conversation with the AI about the map on screen, shared by the Ask
 * panel and its large view, so a question asked in one is still running and
 * answered in the other.
 */
export interface AskSession {
  readonly analysis: Analysis;
  readonly own: OwnQuestion;
  /** The answers kept for the channel, one at most per quick question. */
  readonly kept: readonly KeptAnswer[];
  readonly shown: ShownAnswer;
  /** An AI run is under way here or elsewhere; one at a time, as on the server. */
  readonly busy: boolean;
  /** A channel breakdown is running, named by its channel; null when none is. */
  readonly breakingDown: string | null;
  /** Asks a question in the owner's words; `about` is the channel or video on screen. */
  readonly ask: (question: string, about?: AskAbout) => void;
  readonly quick: (question: AnalysisId) => void;
}

interface Around {
  /** The channel the map is centred on; null before any map. */
  readonly centerId: string | null;
  /** Another AI run (a breakdown, the idea lab) is under way. */
  readonly otherRun: boolean;
  readonly breakingDown: string | null;
}

export function useAskSession(analysis: Analysis, around: Around): AskSession {
  const { centerId, otherRun, breakingDown } = around;
  const { state } = analysis;
  const own = useOwnQuestion(centerId);
  // Read again after each answer, so the ones shown are the latest.
  const kept = useKeptAnswers(centerId, state.status === 'done' ? 1 : 0);
  const [chosen, setChosen] = useState<ShownAnswer | null>(null);
  const shown = chosen ?? (own.answer ? 'own' : (latestKept(kept)?.analysis ?? 'topics'));
  const busy = state.status === 'running' || own.state.status === 'running' || otherRun;

  const { ask: askOwn } = own;
  const { choice, engines, run } = analysis;
  const ask = useCallback(
    (question: string, about?: AskAbout) => {
      setChosen('own');
      askOwn(question, choice, about);
    },
    [askOwn, choice],
  );
  const quick = useCallback(
    (question: AnalysisId) => {
      if (centerId === null) return;
      setChosen(question);
      run(question, centerId, choiceFor(question, choice, engines).choice);
    },
    [centerId, run, choice, engines],
  );
  return { analysis, own, kept, shown, busy, breakingDown, ask, quick };
}

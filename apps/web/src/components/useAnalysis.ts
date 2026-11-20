import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisAnswer, AnalysisId, EngineReport } from '../lib/analyses';
import type { Api } from '../lib/api';

export type AnalysisState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly analysis: AnalysisId }
  | {
      readonly status: 'done';
      readonly analysis: AnalysisId;
      /** The answer as text, the engine that gave it and the engines passed over. */
      readonly answer: AnalysisAnswer;
    }
  | { readonly status: 'failed'; readonly analysis: AnalysisId; readonly message: string };

const IDLE: AnalysisState = { status: 'idle' };

export interface Analysis {
  readonly state: AnalysisState;
  /** Which AI engines are available on this computer; null until the server has said, or if it cannot. */
  readonly engines: EngineReport | null;
  /** Asks an AI engine for one analysis of a channel. Ignored while one is running. */
  readonly run: (analysis: AnalysisId, channelId: string) => void;
}

/** One analysis at a time; the last answer stays on screen until the next is asked for. */
export function useAnalysis(api: Api): Analysis {
  const [state, setState] = useState<AnalysisState>(IDLE);
  const [engines, setEngines] = useState<EngineReport | null>(null);
  // A ref, not state: a second press must be refused before the screen has redrawn.
  const running = useRef(false);

  useEffect(() => {
    let current = true;
    api
      .engines()
      .then((report) => {
        if (current) setEngines(report);
      })
      // The line that names the engines is a courtesy; without it the buttons still work.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [api]);

  const run = useCallback(
    (analysis: AnalysisId, channelId: string) => {
      if (running.current) return;
      running.current = true;
      setState({ status: 'running', analysis });
      api
        .analyse(analysis, channelId)
        .then((answer) => setState({ status: 'done', analysis, answer }))
        .catch((error: unknown) =>
          setState({
            status: 'failed',
            analysis,
            message: error instanceof Error ? error.message : 'The analysis could not finish',
          }),
        )
        .finally(() => {
          running.current = false;
        });
    },
    [api],
  );

  return { state, engines, run };
}

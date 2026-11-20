import { useCallback, useRef, useState } from 'react';
import type { AnalysisId } from '../lib/analyses';
import type { Api } from '../lib/api';

export type AnalysisState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly analysis: AnalysisId }
  | { readonly status: 'done'; readonly analysis: AnalysisId; readonly text: string }
  | { readonly status: 'failed'; readonly analysis: AnalysisId; readonly message: string };

const IDLE: AnalysisState = { status: 'idle' };

export interface Analysis {
  readonly state: AnalysisState;
  /** Asks Claude for one analysis of a channel. Ignored while one is running. */
  readonly run: (analysis: AnalysisId, channelId: string) => void;
}

/** One analysis by Claude at a time; the last answer stays on screen until the next is asked for. */
export function useAnalysis(api: Api): Analysis {
  const [state, setState] = useState<AnalysisState>(IDLE);
  // A ref, not state: a second press must be refused before the screen has redrawn.
  const running = useRef(false);

  const run = useCallback(
    (analysis: AnalysisId, channelId: string) => {
      if (running.current) return;
      running.current = true;
      setState({ status: 'running', analysis });
      api
        .analyse(analysis, channelId)
        .then((text) => setState({ status: 'done', analysis, text }))
        .catch((error: unknown) =>
          setState({
            status: 'failed',
            analysis,
            message: error instanceof Error ? error.message : 'Claude could not finish',
          }),
        )
        .finally(() => {
          running.current = false;
        });
    },
    [api],
  );

  return { state, run };
}

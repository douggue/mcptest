import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { latestKept, type AnalysisId } from '../lib/analyses';
import { breakdownHref } from '../lib/routes';
import { AnalysisAnswerView } from './AnalysisAnswerView';
import { AskPanel, titleOfQuestion, type Question } from './AskPanel';
import { Card } from './layout/Card';
import { SplitView, ViewPage } from './layout/SplitView';
import { NOTE } from './LabStatus';
import type { Analysis } from './useAnalysis';
import { useKeptAnswers } from './useAnswers';

interface Props {
  readonly analysis: Analysis;
  /** Another AI run (a breakdown, the idea lab) is under way, so nothing new can start. */
  readonly otherRun: boolean;
  /** A channel breakdown is running, named by its channel; null when none is. */
  readonly breakingDown: string | null;
  /** The channel the map on screen is centred on. */
  readonly centerId: string;
  readonly centerTitle: string;
}

/** A working line with a pulsing dot. */
function Working({ children }: { readonly children: string }) {
  return (
    <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
      <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** Said when the question chosen has no answer yet. */
function NoAnswer({ question }: { readonly question: AnalysisId }) {
  return (
    <Card>
      <Sparkles aria-hidden="true" className="h-6 w-6 text-metric-amber" />
      <p className="text-body-md text-on-surface">
        No {titleOfQuestion(question).toLowerCase()} answer is kept for this channel yet.
      </p>
      <p className="text-body-sm text-on-surface-variant">
        Choose what to ask and press its button. The answer comes in a minute or two, in short
        first, then part by part.
      </p>
    </Card>
  );
}

/** What the main area shows for one quick analysis: its failure, its new answer, or the one kept. */
function AnalysisArea({
  analysis,
  question,
  kept,
}: {
  readonly analysis: Analysis;
  readonly question: AnalysisId;
  readonly kept: ReturnType<typeof useKeptAnswers>;
}) {
  const { state } = analysis;
  const title = titleOfQuestion(question);
  const ofThis = state.status !== 'idle' && state.analysis === question;
  if (ofThis && state.status === 'failed') {
    return (
      <p role="alert" className="rounded-lg bg-surface-card p-space-lg text-body-md text-error">
        {title} did not finish: {state.message}
      </p>
    );
  }
  if (ofThis && state.status === 'done') {
    return <AnalysisAnswerView title={title} answer={state.answer} kept={false} />;
  }
  const stored = kept.find((entry) => entry.analysis === question);
  if (stored) return <AnalysisAnswerView title={title} answer={stored.answer} kept />;
  return ofThis ? null : <NoAnswer question={question} />;
}

/**
 * Ask AI: the quick questions an AI engine on this computer can be asked
 * about the map on screen, in a side panel with one button, and the answer
 * in the main area, in short first and then section by section. Breaking a
 * channel or a video down has its own destination, Breakdown. (The
 * component keeps its first name; it is no longer one engine only.)
 */
export function AskClaude(props: Props) {
  const { analysis, otherRun, breakingDown, centerId, centerTitle } = props;
  const { state } = analysis;
  // One AI run at a time, here as on the server.
  const busy = state.status === 'running' || otherRun;
  // Read again after each answer, so the ones shown are the latest.
  const kept = useKeptAnswers(centerId, state.status === 'done' ? 1 : 0);
  const [chosen, setChosen] = useState<Question | null>(null);
  const question: Question = chosen ?? latestKept(kept)?.analysis ?? 'topics';
  return (
    <ViewPage id="ask-claude" labelledBy="ask-claude-title">
      <SplitView
        sideLabel="What to ask"
        side={
          <AskPanel
            {...{ analysis, busy, centerId, centerTitle, question }}
            onQuestion={setChosen}
          />
        }
      >
        {state.status === 'running' && (
          <Working>{`Working on: ${titleOfQuestion(state.analysis)}. This usually takes under two minutes.`}</Working>
        )}
        {breakingDown !== null && (
          <p className={NOTE}>
            A breakdown of {breakingDown} is running.{' '}
            <a href={breakdownHref()} className="font-semibold text-primary underline">
              Follow it in Breakdown
            </a>
            .
          </p>
        )}
        <AnalysisArea analysis={analysis} question={question} kept={kept} />
      </SplitView>
    </ViewPage>
  );
}

import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { choiceFor, latestKept, type AnalysisId } from '../lib/analyses';
import { breakdownHref } from '../lib/routes';
import { AnalysisAnswerView } from './AnalysisAnswerView';
import { AiLine } from './AiLine';
import { AskBox, OwnAnswerView, titleOfQuestion, type Question } from './AskBox';
import { Details } from './layout/Details';
import { ViewHeader } from './layout/ViewHeader';
import { useOwnQuestion } from './useOwnQuestion';
import { Card } from './layout/Card';
import { ViewPage } from './layout/SplitView';
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

/** Said when nothing has been asked yet: what to do, in neutral words. */
function NoAnswer() {
  return (
    <Card>
      <Sparkles aria-hidden="true" className="h-6 w-6 text-metric-amber" />
      <p className="text-body-md text-on-surface">
        Ask a question above, or pick one of the suggestions.
      </p>
      <p className="text-body-sm text-on-surface-variant">
        Answers take a minute or two and are kept for this channel.
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
  return ofThis ? null : <NoAnswer />;
}

/**
 * Ask AI: one line to ask anything about the map in your own words, the
 * quick questions as suggestions under it, and the answer below, as
 * readable prose. Breaking a channel or a video down has its own
 * destination, Breakdown. (The component keeps its first name.)
 */
export function AskClaude(props: Props) {
  const { analysis, otherRun, breakingDown, centerId, centerTitle } = props;
  const { state } = analysis;
  const own = useOwnQuestion(centerId);
  // One AI run at a time, here as on the server.
  const busy = state.status === 'running' || own.state.status === 'running' || otherRun;
  // Read again after each answer, so the ones shown are the latest.
  const kept = useKeptAnswers(centerId, state.status === 'done' ? 1 : 0);
  const [chosen, setChosen] = useState<Question | 'own' | null>(null);
  const shown = chosen ?? (own.answer ? 'own' : (latestKept(kept)?.analysis ?? 'topics'));
  const quick = (question: Question): void => {
    setChosen(question);
    analysis.run(question, centerId, choiceFor(question, analysis.choice, analysis.engines).choice);
  };
  return (
    <ViewPage id="ask-claude" labelledBy="ask-claude-title">
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-space-lg">
        <ViewHeader
          titleId="ask-claude-title"
          title="Ask AI"
          lead={`About the map around ${centerTitle}, from what Jgtube has stored.`}
        />
        <AiLine choice={analysis.choice} engines={analysis.engines} />
        <AskBox
          busy={busy}
          onAsk={(question) => {
            setChosen('own');
            own.ask(question, analysis.choice);
          }}
          onQuick={quick}
        />
        {own.state.status === 'running' && (
          <Working>{`Working on your question: ${own.state.question}`}</Working>
        )}
        {own.state.status === 'failed' && (
          <p role="alert" className="rounded-lg bg-surface-card p-space-lg text-body-md text-error">
            Your question was not answered: {own.state.message}
          </p>
        )}
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
        {shown === 'own' ? (
          own.answer && <OwnAnswerView answer={own.answer} />
        ) : (
          <AnalysisArea analysis={analysis} question={shown} kept={kept} />
        )}
        <Details summary="How this works">
          <p className="text-body-sm text-on-surface-variant">
            The AI reads only what Jgtube has stored, through read-only tools: no web and nothing
            that changes your data. Your words are passed as a question, never as instructions. Each
            question uses some of that AI&rsquo;s plan allowance, as a chat would. Answers are kept
            for the channel. To take one channel or video apart, open{' '}
            <a href={breakdownHref()} className="font-semibold text-primary underline">
              Breakdown
            </a>
            .
          </p>
        </Details>
      </div>
    </ViewPage>
  );
}

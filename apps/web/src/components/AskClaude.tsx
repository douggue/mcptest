import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { latestKept, type AnalysisId } from '../lib/analyses';
import type { ChannelChoice } from '../lib/breakdown';
import { AnalysisAnswerView } from './AnalysisAnswerView';
import { AskPanel, titleOfQuestion, type Question } from './AskPanel';
import { BreakdownStatus } from './Breakdown';
import { Card } from './layout/Card';
import { SplitView, ViewPage } from './layout/SplitView';
import { NOTE } from './LabStatus';
import type { SendVideo } from './SupplyVideos';
import type { Analysis } from './useAnalysis';
import { useKeptAnswers } from './useAnswers';
import type { Breakdown } from './useBreakdown';

interface Props {
  readonly analysis: Analysis;
  readonly breakdown: Breakdown;
  /** The channels a breakdown can be asked for: the model, the owner's own and the look-alikes. */
  readonly channels: readonly ChannelChoice[];
  /** Sends the owner's own copy of a video that could not be downloaded. */
  readonly onSendVideo: SendVideo;
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
        Press the button on the left. The answer comes in a minute or two, in short first, then part
        by part.
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
 * Ask AI: what an AI engine on this computer can be asked about the map on
 * screen, in a side panel with one button, and the answer in the main area,
 * in short first and then section by section. Three questions are answered
 * in a minute or two; the fourth, a breakdown of one channel, is a longer job
 * that reports its steps and is kept. (The component keeps its first name;
 * it is no longer one engine only.)
 */
export function AskClaude(props: Props) {
  const { analysis, breakdown, channels, onSendVideo, centerId, centerTitle } = props;
  const { state } = analysis;
  const running = breakdown.state.status === 'running' ? breakdown.state.channel : null;
  const breakingDown = running !== null;
  // One analysis or breakdown runs at a time, here as on the server.
  const busy = state.status === 'running' || breakingDown;
  // Read again after each answer, so the ones shown are the latest.
  const kept = useKeptAnswers(centerId, state.status === 'done' ? 1 : 0);
  const [chosen, setChosen] = useState<Question | null>(null);
  // A breakdown started from another view opens here on the breakdown.
  useEffect(() => {
    if (breakingDown) setChosen('breakdown');
  }, [breakingDown]);
  const question: Question =
    chosen ??
    (breakdown.state.status !== 'idle' ? 'breakdown' : (latestKept(kept)?.analysis ?? 'topics'));
  const send = (channel: { id: string; title: string }, fresh: boolean): void =>
    breakdown.start(channel, analysis.choice, fresh);
  return (
    <ViewPage id="ask-claude" labelledBy="ask-claude-title">
      <SplitView
        sideLabel="What to ask"
        side={
          <AskPanel
            {...{ analysis, breakdown, channels, busy, centerId, centerTitle, question }}
            onQuestion={setChosen}
          />
        }
      >
        {state.status === 'running' && (
          <Working>{`Working on: ${titleOfQuestion(state.analysis)}. This usually takes under two minutes.`}</Working>
        )}
        {running && question !== 'breakdown' && (
          <Working>{`A breakdown of ${running.title} is running. Choose Channel breakdown to follow it.`}</Working>
        )}
        {question === 'breakdown' ? (
          <BreakdownStatus breakdown={breakdown} busy={busy} onSend={onSendVideo} onRun={send} />
        ) : (
          <AnalysisArea analysis={analysis} question={question} kept={kept} />
        )}
      </SplitView>
    </ViewPage>
  );
}

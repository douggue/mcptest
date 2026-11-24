import { Sparkles } from 'lucide-react';
import type { AnalysisId } from '../lib/analyses';
import { breakdownHref } from '../lib/routes';
import { AnalysisAnswerView } from './AnalysisAnswerView';
import { AiLine } from './AiLine';
import { AskInput, OwnAnswerView, QuickQuestions, titleOfQuestion } from './AskBox';
import { Details } from './layout/Details';
import { ViewHeader } from './layout/ViewHeader';
import { ViewPage } from './layout/SplitView';
import { NOTE } from './LabStatus';
import { EmptyState } from './ui/States';
import type { AskSession } from './useAskSession';

/** A working line with a pulsing dot. */
function Working({ children }: { readonly children: string }) {
  return (
    <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
      <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-signal shadow-[0_0_0_4px_rgba(0,210,255,0.18)]" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** What the answer area shows for one quick analysis: its failure, its new answer, or the one kept. */
function AnalysisArea({
  session,
  question,
}: {
  readonly session: AskSession;
  readonly question: AnalysisId;
}) {
  const { state } = session.analysis;
  const title = titleOfQuestion(question);
  const ofThis = state.status !== 'idle' && state.analysis === question;
  if (ofThis && state.status === 'failed') {
    return (
      <p role="alert" className="rounded-lg border border-bad/40 p-space-md text-body-md text-bad">
        {title} did not finish: {state.message}
      </p>
    );
  }
  if (ofThis && state.status === 'done') {
    return <AnalysisAnswerView title={title} answer={state.answer} kept={false} />;
  }
  const stored = session.kept.find((entry) => entry.analysis === question);
  if (stored) return <AnalysisAnswerView title={title} answer={stored.answer} kept />;
  if (ofThis) return null;
  return (
    <EmptyState
      icon={Sparkles}
      title="Nothing asked yet"
      line="Ask a question, or pick one of the suggestions. Answers take a minute or two and are kept."
    />
  );
}

/**
 * What the AI is doing and what it last said: the run under way, a failure,
 * and the answer shown. The same in the Ask panel and in its large view.
 */
export function AskAnswers({ session }: { readonly session: AskSession }) {
  const { own, analysis, shown, breakingDown } = session;
  const { state } = analysis;
  return (
    <div className="flex min-w-0 flex-col gap-space-md">
      {own.state.status === 'running' && (
        <Working>{`Working on your question: ${own.state.question}`}</Working>
      )}
      {own.state.status === 'failed' && (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 p-space-md text-body-md text-bad"
        >
          Your question was not answered: {own.state.message}
        </p>
      )}
      {state.status === 'running' && (
        <Working>{`Working on: ${titleOfQuestion(state.analysis)}. This usually takes under two minutes.`}</Working>
      )}
      {breakingDown !== null && (
        <p className={NOTE}>
          A breakdown of {breakingDown} is running.{' '}
          <a href={breakdownHref()} className="font-semibold text-link underline">
            Follow it
          </a>
          .
        </p>
      )}
      {shown === 'own' ? (
        own.answer && <OwnAnswerView answer={own.answer} />
      ) : (
        <AnalysisArea session={session} question={shown} />
      )}
    </div>
  );
}

/** How Ask works, in one short paragraph behind a disclosure. */
export function AskHow() {
  return (
    <Details summary="How this works">
      <p className="text-body-sm text-muted">
        The AI reads only what Jgtube has stored, through read-only tools: no web and nothing that
        changes your data. Your words are passed as a question, never as instructions. Each question
        uses some of that AI&rsquo;s plan allowance, as a chat would. Answers are kept for the
        channel.
      </p>
    </Details>
  );
}

interface Props {
  readonly session: AskSession;
  readonly centerTitle: string;
}

/**
 * Ask, opened large: one line to ask anything about the map in your own
 * words, the quick questions as suggestions under it, and the answer below,
 * as readable prose. The same conversation as the Ask panel. (The component
 * keeps its first name.)
 */
export function AskClaude({ session, centerTitle }: Props) {
  const { analysis, busy } = session;
  return (
    <ViewPage id="ask-claude" labelledBy="ask-claude-title">
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-space-lg">
        <ViewHeader
          titleId="ask-claude-title"
          title="Ask"
          lead={`About the map around ${centerTitle}, from what Jgtube has stored.`}
        />
        <AiLine choice={analysis.choice} engines={analysis.engines} />
        <AskInput busy={busy} onAsk={session.ask} />
        <QuickQuestions busy={busy} onQuick={session.quick} />
        <AskAnswers session={session} />
        <AskHow />
      </div>
    </ViewPage>
  );
}

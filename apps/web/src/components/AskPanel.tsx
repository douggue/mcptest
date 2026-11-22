import { Sparkles } from 'lucide-react';
import { ANALYSIS_OPTIONS, choiceFor, engineSummary, type AnalysisId } from '../lib/analyses';
import { breakdownHref } from '../lib/routes';
import { AiLine } from './AiLine';
import { Field } from './layout/Card';
import { Details } from './layout/Details';
import { PanelButton } from './layout/PanelButton';
import type { Analysis } from './useAnalysis';

/** What Ask AI can be asked: one of the quick analyses. A breakdown has its own destination. */
export type Question = AnalysisId;

interface QuestionOption {
  readonly id: Question;
  readonly title: string;
  readonly description: string;
  readonly action: string;
}

const QUESTIONS: readonly QuestionOption[] = ANALYSIS_OPTIONS;

/** The title of what can be asked, as the panel lists it. */
export const titleOfQuestion = (id: Question): string =>
  QUESTIONS.find((option) => option.id === id)?.title ?? '';

function QuestionList({
  value,
  onChange,
  disabled,
}: {
  readonly value: Question;
  readonly onChange: (question: Question) => void;
  readonly disabled: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="What to ask" className="flex min-w-0 flex-col gap-1.5">
      {QUESTIONS.map((option) => {
        const chosen = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={chosen}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={`flex min-w-0 flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              chosen
                ? 'border-primary-container bg-surface-card'
                : 'border-border-subtle bg-space-deep hover:bg-surface-card'
            }`}
          >
            <span
              className={`text-body-md font-semibold ${chosen ? 'text-primary' : 'text-on-surface'}`}
            >
              {option.title}
            </span>
            {chosen && (
              <span className="text-body-sm text-on-surface-variant">{option.description}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  readonly analysis: Analysis;
  readonly question: Question;
  readonly onQuestion: (question: Question) => void;
  /** An AI run is under way; one at a time, here as on the server. */
  readonly busy: boolean;
  readonly centerId: string;
  readonly centerTitle: string;
}

/** The label of the panel's one button: what pressing it asks, or that it is working. */
function actionOf(props: Props): string {
  const { question, analysis } = props;
  const running = analysis.state.status === 'running' && analysis.state.analysis === question;
  if (running) return 'Working…';
  return QUESTIONS.find((option) => option.id === question)?.action ?? '';
}

/**
 * The side panel of Ask AI: which AI answers, what to ask, the channel for
 * a breakdown, how it works behind a disclosure, and the one button.
 */
export function AskPanel(props: Props) {
  const { analysis, question, onQuestion, busy, centerId, centerTitle } = props;
  const available = engineSummary(analysis.engines);
  const plan = choiceFor(question, analysis.choice, analysis.engines);
  const ask = (): void => analysis.run(question, centerId, plan.choice);
  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="ask-claude-title" className="flex items-center gap-2 text-headline-md font-bold">
          <Sparkles aria-hidden="true" className="h-5 w-5 flex-none text-metric-amber" />
          <span className="text-on-surface">Ask AI</span>
        </h2>
        <p className="text-body-sm text-on-surface-variant">
          About the map around {centerTitle}, or one channel in depth.
        </p>
      </div>
      <AiLine choice={analysis.choice} engines={analysis.engines} />
      <Field label="What to ask">
        <QuestionList value={question} onChange={onQuestion} disabled={false} />
      </Field>
      {plan.note && <p className="text-body-sm text-metric-amber">{plan.note}</p>}
      <p className="text-body-sm text-on-surface-variant">
        To take one channel or one video apart in depth, open{' '}
        <a href={breakdownHref()} className="font-semibold text-primary underline">
          Breakdown
        </a>
        .
      </p>
      <Details summary="How this works">
        <div className="flex flex-col gap-2 text-body-sm text-on-surface-variant">
          <p>
            The AI reads only what Jgtube has stored, through read-only tools. Each press uses some
            of that AI&rsquo;s plan allowance, as a chat would. Answers are kept for the channel.
          </p>
          {available !== '' && <p className="text-outline">{available}</p>}
        </div>
      </Details>
      <PanelButton icon={Sparkles} onClick={ask} disabled={busy}>
        {actionOf(props)}
      </PanelButton>
    </>
  );
}

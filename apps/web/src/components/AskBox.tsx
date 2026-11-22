import { ArrowUp } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ANALYSIS_OPTIONS, engineName, type AnalysisId, type AnyEngineId } from '../lib/analyses';
import { askBlocked, MAX_QUESTION_CHARS, type OwnAnswer } from '../lib/ownQuestion';
import { Answer } from './Answer';
import { DisabledReason } from './layout/PanelAction';

/** What Ask AI can be asked besides your own words: one of the quick analyses. */
export type Question = AnalysisId;

/** The title of a quick question, as the suggestions list it. */
export const titleOfQuestion = (id: Question): string =>
  ANALYSIS_OPTIONS.find((option) => option.id === id)?.title ?? '';

interface BoxProps {
  /** An AI run is under way; one at a time. */
  readonly busy: boolean;
  readonly onAsk: (question: string) => void;
  /** Runs one of the quick questions. */
  readonly onQuick: (question: Question) => void;
}

const SUGGESTION =
  'min-h-11 rounded-full border border-border-subtle px-4 text-body-sm text-on-surface-variant transition-colors hover:bg-surface-card hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50';

/**
 * One line to ask anything about the map in your own words, with the one
 * button, and the quick questions as suggestions under it.
 */
export function AskBox({ busy, onAsk, onQuick }: BoxProps) {
  const [question, setQuestion] = useState('');
  const blocked = askBlocked(question, busy);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (question.trim() === '' || blocked) return;
    onAsk(question.trim());
    setQuestion('');
  };
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <form
        onSubmit={submit}
        className="flex min-w-0 items-center gap-2 rounded-lg border border-border-subtle bg-surface-card p-2 focus-within:border-border-highlight"
      >
        <label htmlFor="own-question" className="sr-only">
          Your question
        </label>
        <input
          id="own-question"
          type="text"
          value={question}
          maxLength={MAX_QUESTION_CHARS * 2}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask anything about this map…"
          className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-body-lg text-on-surface placeholder:text-outline focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Ask"
          disabled={question.trim() === '' || blocked !== null}
          className="flex h-11 w-11 flex-none items-center justify-center rounded bg-primary-container text-on-primary transition-opacity hover:opacity-90 disabled:bg-surface-container-high disabled:text-outline"
        >
          <ArrowUp aria-hidden="true" className="h-5 w-5" />
        </button>
      </form>
      <DisabledReason reason={blocked} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-body-sm text-outline">Or try:</span>
        {ANALYSIS_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={busy}
            onClick={() => onQuick(option.id)}
            className={SUGGESTION}
          >
            {option.title}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Your last question and its answer, as readable prose. */
export function OwnAnswerView({ answer }: { readonly answer: OwnAnswer }) {
  return (
    <section aria-label="Your question" className="flex min-w-0 flex-col gap-space-sm">
      {answer.question && (
        <p className="text-body-md text-on-surface-variant">
          You asked: <span className="text-on-surface">{answer.question}</span>
        </p>
      )}
      <Answer text={answer.text} />
      <p className="text-body-sm text-outline">
        Answered by {engineName(answer.engine as AnyEngineId) ?? answer.engine}.
      </p>
    </section>
  );
}

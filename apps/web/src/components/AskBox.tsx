import { ArrowUp, Sparkles } from 'lucide-react';
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

interface InputProps {
  /** An AI run is under way; one at a time. */
  readonly busy: boolean;
  readonly onAsk: (question: string) => void;
  /** The box's id; the panel and the large view each have their own. */
  readonly id?: string;
  readonly placeholder?: string;
  /** Words a press of the chip puts at the start of the question, such as a channel's name. */
  readonly starter?: { readonly label: string; readonly text: string } | null;
}

const SUGGESTION =
  'min-h-11 flex-none whitespace-nowrap rounded-full border border-line px-4 text-body-sm text-muted transition-colors hover:border-line-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-50';

/** One line to ask anything about the map in your own words, with the one button. */
export function AskInput({ busy, onAsk, id = 'own-question', placeholder, starter }: InputProps) {
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
      {starter && !question.startsWith(starter.text) && (
        <button
          type="button"
          onClick={() => setQuestion(`${starter.text}${question}`)}
          className={`${SUGGESTION} w-fit max-w-full truncate`}
        >
          {starter.label}
        </button>
      )}
      <form
        onSubmit={submit}
        className="flex min-w-0 items-center gap-2 rounded border border-signal/35 bg-white/[0.035] p-1.5 focus-within:border-signal/70"
      >
        <label htmlFor={id} className="sr-only">
          Your question
        </label>
        <input
          id={id}
          type="text"
          value={question}
          maxLength={MAX_QUESTION_CHARS * 2}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={placeholder ?? 'Ask anything about this map…'}
          className="min-h-11 min-w-0 flex-1 bg-transparent px-2.5 text-body-md text-ink placeholder:text-dim focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Ask"
          disabled={question.trim() === '' || blocked !== null}
          className="grid h-11 w-11 flex-none place-items-center rounded-md bg-signal text-on-signal transition-opacity hover:opacity-90 disabled:bg-card-2 disabled:text-dim"
        >
          <ArrowUp aria-hidden="true" className="h-5 w-5" />
        </button>
      </form>
      <DisabledReason reason={blocked} />
    </div>
  );
}

interface QuickProps {
  readonly busy: boolean;
  /** Runs one of the quick questions. */
  readonly onQuick: (question: Question) => void;
  /** One row that scrolls sideways, as in the panel; wraps otherwise. */
  readonly oneRow?: boolean;
}

/** The quick questions, as suggestions. */
export function QuickQuestions({ busy, onQuick, oneRow }: QuickProps) {
  return (
    <div
      aria-label="Quick questions"
      role="group"
      className={`flex min-w-0 items-center gap-2 ${oneRow ? 'no-scrollbar overflow-x-auto' : 'flex-wrap'}`}
    >
      {!oneRow && <span className="text-body-sm text-dim">Or try:</span>}
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
      <p className="flex items-center gap-2 text-[13px] leading-[18px] text-dim">
        <Sparkles aria-hidden="true" className="h-4 w-4 flex-none text-link" />
        The AI’s reading, written by {engineName(answer.engine as AnyEngineId) ?? answer.engine}.
      </p>
    </section>
  );
}

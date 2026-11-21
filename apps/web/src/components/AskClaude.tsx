import { Sparkles } from 'lucide-react';
import {
  ANALYSIS_OPTIONS,
  ENGINE_CHOICES,
  answerCredit,
  choiceHelp,
  engineSummary,
  readAnswer,
  skippedNotes,
  type AnalysisAnswer,
  type AnalysisOption,
  type EngineChoice,
  type EngineReport,
} from '../lib/analyses';
import type { Analysis, AnalysisState } from './useAnalysis';

const NOTE = 'rounded bg-surface-card p-space-lg text-body-md text-on-surface-variant';

const titleOf = (state: AnalysisState): string =>
  state.status === 'idle'
    ? ''
    : (ANALYSIS_OPTIONS.find((option) => option.id === state.analysis)?.title ?? '');

interface OptionProps {
  readonly option: AnalysisOption;
  readonly busy: boolean;
  readonly active: boolean;
  readonly onRun: () => void;
}

/** One analysis: what it gives, and the button that asks for it. */
function Option({ option, busy, active, onRun }: OptionProps) {
  return (
    <div className="flex flex-col justify-between gap-space-md rounded bg-surface-card p-space-md shadow-md">
      <div>
        <h3 className="text-title-md text-on-surface">{option.title}</h3>
        <p className="mt-1 text-body-sm text-on-surface-variant">{option.description}</p>
      </div>
      <button
        type="button"
        onClick={onRun}
        disabled={busy}
        className="self-start rounded-full bg-on-surface px-4 py-1.5 text-body-sm font-semibold text-space-deep transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {active ? 'Working…' : option.action}
      </button>
    </div>
  );
}

interface SwitchProps {
  readonly choice: EngineChoice;
  readonly engines: EngineReport | null;
  readonly busy: boolean;
  readonly onChoose: (choice: EngineChoice) => void;
}

/** The switch for which AI answers: Automatic, or one engine and nothing else. */
function EngineSwitch({ choice, engines, busy, onChoose }: SwitchProps) {
  return (
    <div className="flex flex-col gap-1">
      <div
        role="radiogroup"
        aria-label="Which AI answers"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="text-label-caps uppercase text-outline">AI</span>
        {ENGINE_CHOICES.map((option) => {
          const chosen = option.choice === choice;
          return (
            <button
              key={option.choice}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={busy}
              onClick={() => onChoose(option.choice)}
              className={`rounded-full px-3 py-1 text-body-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                chosen
                  ? 'bg-primary-container text-space-deep'
                  : 'bg-surface-card text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-body-sm text-outline">{choiceHelp(choice, engines)}</p>
    </div>
  );
}

/** The answer, set out as headings, list items and paragraphs. Shown as text only. */
function Answer({ text }: { readonly text: string }) {
  const blocks = readAnswer(text);
  return (
    <div className="flex flex-col gap-2 rounded bg-surface-card p-space-lg">
      {blocks.map((block, index) => {
        const key = `${index}-${block.kind}`;
        if (block.kind === 'heading') {
          return (
            <h4 key={key} className="mt-2 text-label-caps uppercase text-primary first:mt-0">
              {block.text}
            </h4>
          );
        }
        if (block.kind === 'item') {
          return (
            <p key={key} className="flex gap-2 text-body-md text-on-surface">
              <span aria-hidden="true" className="text-outline">
                –
              </span>
              <span>{block.text}</span>
            </p>
          );
        }
        return (
          <p key={key} className="text-body-md text-on-surface">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

/** Who answered, and for each engine passed over, why: that often says what to do about it. */
function Credit({ answer }: { readonly answer: AnalysisAnswer }) {
  const credit = answerCredit(answer);
  if (credit === '') return null;
  return (
    <div className="flex flex-col gap-1 text-body-sm text-outline">
      <p>{credit}</p>
      {skippedNotes(answer.skipped).map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  );
}

interface Props {
  readonly analysis: Analysis;
  /** The channel the map on screen is centred on. */
  readonly centerId: string;
  readonly centerTitle: string;
}

/**
 * Three questions an AI engine on this computer can answer about the map on
 * screen with one press: what the winning thumbnails do, which videos to make
 * next, and which left-out channels cover the same ground in other words.
 * Claude Code is the main engine, with Antigravity and Codex as backups; the
 * switch lets the owner pick one of them instead. (The component keeps its
 * first name; it is no longer Claude only.)
 */
export function AskClaude({ analysis, centerId, centerTitle }: Props) {
  const { state, engines, choice, choose, run } = analysis;
  const busy = state.status === 'running';
  const available = engineSummary(engines);

  return (
    <section
      aria-labelledby="ask-claude-title"
      className="w-full bg-space-deep px-gutter-desktop pb-space-xl"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-space-lg">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="h-[22px] w-[22px] text-metric-amber" />
            <h2
              id="ask-claude-title"
              className="text-headline-lg font-bold tracking-tight text-on-surface"
            >
              Ask AI
            </h2>
          </div>
          <p className="mt-1 text-body-md text-on-surface-variant">
            An AI on this computer reads what Jgtube has stored around {centerTitle} and answers in
            a minute or two. Each press uses some of that AI&rsquo;s plan allowance, as a chat
            would.
          </p>
          {available !== '' && <p className="mt-1 text-body-sm text-outline">{available}</p>}
        </div>

        <EngineSwitch choice={choice} engines={engines} busy={busy} onChoose={choose} />

        <div className="grid grid-cols-1 gap-space-md md:grid-cols-3">
          {ANALYSIS_OPTIONS.map((option) => (
            <Option
              key={option.id}
              option={option}
              busy={busy}
              active={busy && state.analysis === option.id}
              onRun={() => run(option.id, centerId)}
            />
          ))}
        </div>

        {state.status === 'running' && (
          <p role="status" className={`flex items-center gap-2 ${NOTE}`}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary-container shadow-[0_0_8px_#00d2ff]" />
            Working on: {titleOf(state)}. This usually takes under two minutes.
          </p>
        )}
        {state.status === 'failed' && (
          <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
            {titleOf(state)} did not finish: {state.message}
          </p>
        )}
        {state.status === 'done' && (
          <div className="flex flex-col gap-space-sm">
            <h3 className="text-title-md text-on-surface">{titleOf(state)}</h3>
            <Answer text={state.answer.text} />
            <Credit answer={state.answer} />
          </div>
        )}
      </div>
    </section>
  );
}

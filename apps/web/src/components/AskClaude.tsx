import { Sparkles } from 'lucide-react';
import { ANALYSIS_OPTIONS, readAnswer, type AnalysisOption } from '../lib/analyses';
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
        {active ? 'Claude is working…' : option.action}
      </button>
    </div>
  );
}

/** Claude's answer, set out as headings, list items and paragraphs. Shown as text only. */
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

interface Props {
  readonly analysis: Analysis;
  /** The channel the map on screen is centred on. */
  readonly centerId: string;
  readonly centerTitle: string;
}

/**
 * Three questions Claude can answer about the map on screen with one press:
 * what the winning thumbnails do, which videos to make next, and which
 * left-out channels cover the same ground in other words.
 */
export function AskClaude({ analysis, centerId, centerTitle }: Props) {
  const { state, run } = analysis;
  const busy = state.status === 'running';

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
              Ask Claude
            </h2>
          </div>
          <p className="mt-1 text-body-md text-on-surface-variant">
            Claude reads what Jgtube has stored around {centerTitle} and answers in about a minute.
            Each press runs Claude Code on this computer and uses some of your Claude plan&rsquo;s
            allowance, as a chat would.
          </p>
        </div>

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
            Claude is working on: {titleOf(state)}. This usually takes under two minutes.
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
            <Answer text={state.text} />
          </div>
        )}
      </div>
    </section>
  );
}

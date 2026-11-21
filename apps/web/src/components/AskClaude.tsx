import { Sparkles } from 'lucide-react';
import { ANALYSIS_OPTIONS, engineSummary, type AnalysisOption } from '../lib/analyses';
import type { ChannelChoice } from '../lib/breakdown';
import { AnalysisAnswerView } from './AnalysisAnswerView';
import { BreakdownCard, BreakdownStatus } from './Breakdown';
import { EngineSwitch } from './EngineSwitch';
import { SectionFrame } from './SectionFrame';
import type { SendVideo } from './SupplyVideos';
import type { Analysis, AnalysisState } from './useAnalysis';
import { useKeptAnswer } from './useAnswers';
import type { Breakdown } from './useBreakdown';

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
    <div className="flex flex-col gap-space-sm rounded bg-surface-card p-space-md shadow-md">
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

/**
 * What an AI engine on this computer can be asked about the map on screen.
 * Three questions are answered with one press: what the winning thumbnails
 * do, which videos to make next, and which left-out channels cover the same
 * ground in other words. The fourth, a breakdown of one channel, is a longer
 * job that reports its steps and is kept: picking a channel shows the
 * breakdown stored for it. Claude Code is the main engine, with
 * Antigravity and Codex as backups; the switch lets the owner pick one of
 * them instead. (The component keeps its first name; it is no longer Claude only.)
 */
export function AskClaude(props: Props) {
  const { analysis, breakdown, channels, onSendVideo, centerId, centerTitle } = props;
  const { state, engines, choice, choose, run } = analysis;
  const breakingDown = breakdown.state.status === 'running';
  // One analysis or breakdown runs at a time, here as on the server.
  const busy = state.status === 'running' || breakingDown;
  const available = engineSummary(engines);
  // Read again after each answer, so the one shown when nothing is asked is the latest.
  const kept = useKeptAnswer(centerId, state.status === 'done' ? 1 : 0);
  const keptTitle = ANALYSIS_OPTIONS.find((option) => option.id === kept?.analysis)?.title ?? '';

  return (
    <SectionFrame
      id="ask-claude"
      titleId="ask-claude-title"
      title="Ask AI"
      icon={Sparkles}
      lead={
        <>
          Ask an AI on this computer about the map around {centerTitle}, or break one channel down.
        </>
      }
      howItWorks={
        <>
          <p>
            The AI reads only what Jgtube has stored, through read-only tools, and answers in a
            minute or two. Each press uses some of that AI&rsquo;s plan allowance, as a chat would.
            Each video an answer rests on is shown as its real thumbnail; answers are kept for the
            channel.
          </p>
          {available !== '' && <p className="text-outline">{available}</p>}
        </>
      }
    >
      <EngineSwitch choice={choice} engines={engines} busy={busy} onChoose={choose} />

      <div className="grid grid-cols-1 gap-space-md md:grid-cols-2 xl:grid-cols-4 items-start">
        {ANALYSIS_OPTIONS.map((option) => (
          <Option
            key={option.id}
            option={option}
            busy={busy}
            active={state.status === 'running' && state.analysis === option.id}
            onRun={() => run(option.id, centerId)}
          />
        ))}
        <BreakdownCard
          choices={channels}
          picked={breakdown.picked}
          onPick={breakdown.pick}
          busy={busy}
          active={breakingDown}
          onRun={(channel, fresh) => breakdown.start(channel, choice, fresh)}
        />
      </div>

      <BreakdownStatus
        breakdown={breakdown}
        busy={busy}
        onSend={onSendVideo}
        onRun={(channel, fresh) => breakdown.start(channel, choice, fresh)}
      />

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
        <AnalysisAnswerView title={titleOf(state)} answer={state.answer} kept={false} />
      )}
      {state.status === 'idle' && kept !== null && (
        <AnalysisAnswerView title={keptTitle} answer={kept.answer} kept />
      )}
    </SectionFrame>
  );
}

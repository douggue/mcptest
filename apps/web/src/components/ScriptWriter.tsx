import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { thumbnailFor } from '../lib/ideaLab';
import { sourcesMarkdown } from '../lib/research';
import {
  openingStep,
  stageStates,
  type ScriptStage,
  type ScriptView,
  type VoiceChoice,
} from '../lib/scriptWriter';
import { Card } from './layout/Card';
import { SplitView, ViewPage } from './layout/SplitView';
import { ViewHeader } from './layout/ViewHeader';
import { LabStatus } from './LabStatus';
import { ScriptFooter, ScriptTopBar } from './ScriptBars';
import { ScriptEditor } from './ScriptEditor';
import { HooksAndBeats, Models } from './ScriptHooks';
import { ScriptPanel } from './ScriptPanel';
import { ScriptPicker } from './ScriptPicker';
import { StepRun } from './ScriptSteps';
import type { Lab } from './useLab';
import type { Research } from './useResearch';
import type { Script } from './useScript';

interface Props {
  readonly script: Script;
  /** The open concept's fact sheet and claims check. */
  readonly research: Research;
  readonly lab: Lab;
  /** An AI run is under way somewhere on the page. */
  readonly busy: boolean;
  /** The channels of this map a script can be written in the voice of. */
  readonly voices: readonly VoiceChoice[];
  /** The kept concepts that have a script started; null while that is read. */
  readonly scripted: ReadonlySet<number> | null;
}

/** What each step is about, in one line, with its numbers. */
function aboutOf(stage: ScriptStage, view: ScriptView): string {
  if (stage === 'hooks') {
    return `Three hooks of about ${view.plan.hookSeconds} seconds each at this voice’s rate (${view.plan.hookWords ?? '—'} words), each opening in a different way, then a beat sheet for the rest.`;
  }
  if (stage === 'draft') {
    return `The full script for the chosen hook and the beats: about ${view.plan.targetWords ?? '—'} words, with a picture cue before the words it covers.`;
  }
  return 'The same script made easier to say and to follow, toward the voice channel’s own reading grade, with no fact added.';
}

/** The concept the script is for: its title, and its thumbnail with the words on it. */
function ConceptHeader({ view }: { readonly view: ScriptView }) {
  const { concept } = view;
  return (
    <Card>
      <h3 className="break-words text-headline-lg font-bold leading-tight text-on-surface">
        {concept.title}
      </h3>
      <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-body-sm">
        <span className="text-label text-outline">Thumbnail</span>
        <span className="min-w-0 flex-1 basis-60 break-words text-on-surface">
          {concept.thumbnail}
        </span>
        <span className="rounded bg-metric-amber-bg px-3 py-1 font-bold uppercase text-metric-amber">
          {concept.overlay}
        </span>
      </p>
    </Card>
  );
}

/** The open script: the side panel, the steps and the step on screen, and the footer of counts. */
function Workbench(props: Props & { readonly view: ScriptView }) {
  const { script, research, lab, busy, voices, view } = props;
  const states = stageStates(view.script);
  const [picked, setPicked] = useState<ScriptStage | null>(null);
  const step = picked ?? openingStep(states);
  const state = states.find((entry) => entry.stage === step);
  const hooks = lab.library?.hooks ?? [];
  const field = step === 'tighten' && view.script?.tightened ? 'tightened' : 'draft';
  const text = view.script?.[field] ?? '';
  const edit = (next: string): void =>
    script.change(field === 'tightened' ? { tightened: next } : { draft: next });
  const exports = {
    title: view.concept.title,
    text,
    wordsPerMinute: view.script?.wordsPerMinute ?? null,
    markFacts: view.markFacts ?? true,
    thumbnailPrompt: thumbnailFor(lab.thumbnails, view.concept.id)?.prompt ?? null,
    sources: sourcesMarkdown(text, research.view?.sheet ?? null),
  };
  const panel = { script, research, lab, busy, voices, view, text, field } as const;
  return (
    <SplitView
      width="narrow"
      mainFirst
      sideLabel="The script's voice, length and checks"
      side={<ScriptPanel {...panel} stage={step} onChange={edit} />}
    >
      <button
        type="button"
        onClick={script.close}
        className="flex min-h-11 w-fit items-center gap-1.5 rounded text-body-sm font-semibold text-on-surface-variant hover:text-on-surface"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        All scripts
      </button>
      <ScriptTopBar
        script={script}
        view={view}
        tabs={{ states, current: step, onPick: setPicked }}
        exports={exports}
      />
      <ConceptHeader view={view} />
      <LabStatus
        state={lab.jobs.state}
        kinds={['script-hooks', 'script-draft', 'script-tighten', 'voice-read', 'thumbnail']}
        working="Working on the script"
        takes="A step takes one to six minutes and uses some of the AI’s plan allowance. Keep this page open."
      />
      <Card>
        <StepRun
          about={aboutOf(step, view)}
          state={state}
          busy={busy}
          onRun={() => script.runStage(step)}
        />
        {step === 'hooks' ? (
          <>
            <Models script={script} view={view} busy={busy} hooks={hooks} />
            <HooksAndBeats script={script} view={view} busy={busy} hooks={hooks} />
          </>
        ) : (
          <ScriptEditor view={view} which={field} onChange={edit} />
        )}
      </Card>
      <ScriptFooter view={view} text={text} stage={step} />
    </SplitView>
  );
}

/**
 * The script writer: one kept concept taken to a script in three steps.
 * Opened by a concept's "Write the script" button in Ideas, or from the list
 * of kept ideas shown here when no script is open.
 */
export function ScriptWriter(props: Props) {
  const { script } = props;
  const { view } = script;
  return (
    <ViewPage id="script-writer">
      {script.problem && (
        <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
          {script.problem}
        </p>
      )}
      {view ? (
        <Workbench key={view.concept.id} {...props} view={view} />
      ) : (
        <>
          <ViewHeader
            titleId="script-writer-title"
            title="Script"
            lead="Hooks and beats, then the draft, then a tighten pass."
          />
          <ScriptPicker
            concepts={props.lab.concepts}
            scripted={props.scripted}
            onOpen={script.open}
          />
        </>
      )}
    </ViewPage>
  );
}

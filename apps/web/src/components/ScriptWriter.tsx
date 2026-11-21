import { PenLine, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { thumbnailFor } from '../lib/ideaLab';
import {
  openingStep,
  stageStates,
  type ScriptStage,
  type ScriptView,
  type VoiceChoice,
} from '../lib/scriptWriter';
import { ConceptThumbnail } from './ConceptThumbnail';
import { LabStatus, NOTE } from './LabStatus';
import { ScriptEditor } from './ScriptEditor';
import { HooksAndBeats, Models } from './ScriptHooks';
import { ScriptOrigins } from './ScriptOrigins';
import { ScriptSetup } from './ScriptSetup';
import { StepRun, StepTabs } from './ScriptSteps';
import { SectionFrame } from './SectionFrame';
import type { Lab } from './useLab';
import type { Script } from './useScript';

const CARD = 'flex min-w-0 flex-col gap-space-md rounded bg-surface-card p-space-md shadow-md';

interface Props {
  readonly script: Script;
  readonly lab: Lab;
  /** An AI run is under way somewhere on the page. */
  readonly busy: boolean;
  /** The channels of this map a script can be written in the voice of. */
  readonly voices: readonly VoiceChoice[];
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

/** The open script: its setup, the three steps as tabs, and the step on screen. */
function Workbench({ script, lab, busy, voices, view }: Props & { readonly view: ScriptView }) {
  const states = stageStates(view.script);
  const [picked, setPicked] = useState<ScriptStage | null>(null);
  const step = picked ?? openingStep(states);
  const state = states.find((entry) => entry.stage === step);
  const hooks = lab.library?.hooks ?? [];
  const thumbnail = thumbnailFor(lab.thumbnails, view.concept.id);
  const run = (): void => script.runStage(step);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 break-words text-headline-md text-on-surface">
          {view.concept.title}
        </h3>
        <span role="status" className="text-body-sm text-outline">
          {script.saving === 'saving'
            ? 'Saving…'
            : script.saving === 'failed'
              ? 'Not saved'
              : 'Saved on this computer'}
        </span>
      </div>
      <ScriptOrigins conceptId={view.concept.id} />
      <ScriptSetup script={script} view={view} busy={busy} voices={voices} />
      <LabStatus
        state={lab.jobs.state}
        kinds={['script-hooks', 'script-draft', 'script-tighten', 'voice-read', 'thumbnail']}
        working="Working on the script"
        takes="A step takes one to six minutes and uses some of the AI’s plan allowance. Keep this page open."
      />
      <StepTabs states={states} current={step} onPick={setPicked} />
      <div className={CARD}>
        <StepRun about={aboutOf(step, view)} state={state} busy={busy} onRun={run} />
        {step === 'hooks' && (
          <>
            <Models script={script} view={view} busy={busy} hooks={hooks} />
            <HooksAndBeats script={script} view={view} busy={busy} hooks={hooks} />
          </>
        )}
        {step !== 'hooks' && (
          <ScriptEditor
            view={view}
            which={step === 'tighten' && view.script?.tightened ? 'tightened' : 'draft'}
            onChange={(text) =>
              script.change(
                step === 'tighten' && view.script?.tightened
                  ? { tightened: text }
                  : { draft: text },
              )
            }
            thumbnailPrompt={thumbnail?.prompt ?? null}
          />
        )}
      </div>
      <ConceptThumbnail
        title={view.concept.title}
        thumbnail={thumbnail}
        busy={busy}
        onWrite={() => lab.writeThumbnail(view.concept.id)}
      />
    </>
  );
}

/**
 * The script writer: one kept concept taken to a script in three steps, with
 * everything about the text counted in code beside a wide editor. Opened by a
 * concept's "Write the script" button in the idea lab.
 */
export function ScriptWriter(props: Props) {
  const { script } = props;
  const { view } = script;
  const markFacts = view?.markFacts ?? true;
  return (
    <SectionFrame
      id="script-writer"
      titleId="script-writer-title"
      title="Script writer"
      icon={PenLine}
      lead="One kept concept taken to a script in three steps: hooks and a beat sheet, the draft, and a tighten pass."
      howItWorks={
        <p>
          An AI writes it from what Jgtube has stored and from memory, in the voice of a channel on
          this map, to the length you set. The numbers beside the editor (words, spoken time,
          reading grade, facts to check) are counted in code.
        </p>
      }
    >
      <p className="flex items-start gap-2 rounded bg-metric-amber-bg p-space-sm text-body-sm text-on-surface">
        <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none text-metric-amber" />
        {markFacts
          ? 'Some facts may be wrong. Every fact the AI could not vouch for is followed by [CHECK: what to verify]: check each one yourself before you record. Invented facts stated as true break YouTube’s rules on misleading content.'
          : 'Some facts may be wrong, and the marking of facts to check is off in Settings: check every name, number and date yourself before you record.'}
      </p>
      {script.problem && (
        <p role="alert" className="rounded bg-surface-card p-space-lg text-body-md text-error">
          {script.problem}
        </p>
      )}
      {view ? (
        <Workbench key={view.concept.id} {...props} view={view} />
      ) : (
        <p className={NOTE}>
          No script is open. Press &ldquo;Write the script&rdquo; on a concept in the idea lab to
          start its script, or to come back to it.
        </p>
      )}
    </SectionFrame>
  );
}

import { Check, Sparkles } from 'lucide-react';
import type { ScriptStage, StageState } from '../lib/scriptWriter';

export const STEP_NAMES: Readonly<Record<ScriptStage, string>> = {
  hooks: 'Hooks and beat sheet',
  draft: 'The draft',
  tighten: 'Tighten pass',
};

/** The short names on the tabs. */
const TAB_NAMES: Readonly<Record<ScriptStage, string>> = {
  hooks: 'Hooks & beats',
  draft: 'Draft',
  tighten: 'Tighten',
};

const ACTIONS: Readonly<Record<ScriptStage, string>> = {
  hooks: 'Write the hooks and the beat sheet',
  draft: 'Write the draft',
  tighten: 'Tighten it',
};

interface TabsProps {
  readonly states: readonly StageState[];
  readonly current: ScriptStage;
  readonly onPick: (stage: ScriptStage) => void;
}

/** The three steps as a segmented control, each saying whether it is written. */
export function StepTabs({ states, current, onPick }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Steps of the script"
      className="inline-flex min-w-0 flex-wrap gap-1 rounded-lg border border-border-subtle bg-space-deep p-1"
    >
      {states.map((state, index) => {
        const chosen = state.stage === current;
        return (
          <button
            key={state.stage}
            type="button"
            role="tab"
            aria-selected={chosen}
            onClick={() => onPick(state.stage)}
            className={`flex min-h-9 items-center gap-1.5 rounded-md px-3 text-body-sm font-semibold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container ${
              chosen
                ? 'bg-primary-container text-space-deep'
                : 'text-on-surface-variant hover:bg-surface-card hover:text-on-surface'
            }`}
          >
            {index + 1}. {TAB_NAMES[state.stage]}
            {state.done && <Check aria-label="written" className="h-4 w-4" />}
          </button>
        );
      })}
    </div>
  );
}

/** A step not yet run is the screen's next step; running one again is a quiet choice. */
const RUN_FIRST =
  'flex min-h-11 items-center gap-2 rounded bg-primary-container px-4 text-body-sm font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const RUN_AGAIN =
  'flex min-h-11 items-center gap-2 rounded border border-border-subtle px-4 text-body-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50';

interface RunProps {
  readonly about: string;
  readonly state: StageState | undefined;
  readonly busy: boolean;
  readonly onRun: () => void;
}

/** The step on screen: its name and what it does at the left, the button that has an AI write it at the right. */
export function StepRun({ about, state, busy, onRun }: RunProps) {
  const stage = state?.stage ?? 'hooks';
  const number = ['hooks', 'draft', 'tighten'].indexOf(stage) + 1;
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-space-md">
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-0.5">
        <h3 className="text-title-md font-bold text-on-surface">
          Step {number}: {STEP_NAMES[stage]}
        </h3>
        <p className="text-body-sm text-on-surface-variant">{about}</p>
        {state?.blocked && <p className="text-body-sm text-outline">{state.blocked}</p>}
        {busy && !state?.blocked && (
          <p className="text-body-sm text-outline">Waits for the AI run under way to finish.</p>
        )}
      </div>
      <button
        type="button"
        disabled={busy || state === undefined || state.blocked !== null}
        onClick={onRun}
        className={state?.done ? RUN_AGAIN : RUN_FIRST}
      >
        <Sparkles aria-hidden="true" className="h-4 w-4" />
        {state?.done ? `${ACTIONS[stage]} again` : ACTIONS[stage]}
      </button>
    </div>
  );
}

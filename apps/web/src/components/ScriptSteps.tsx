import { Check } from 'lucide-react';
import type { ScriptStage, StageState } from '../lib/scriptWriter';
import { PRIMARY_BUTTON } from './LabStatus';

export const STEP_NAMES: Readonly<Record<ScriptStage, string>> = {
  hooks: 'Hooks and beat sheet',
  draft: 'The draft',
  tighten: 'Tighten pass',
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

/** The three steps as tabs, each saying whether it is written. */
export function StepTabs({ states, current, onPick }: TabsProps) {
  return (
    <div role="tablist" aria-label="Steps of the script" className="flex flex-wrap gap-2">
      {states.map((state, index) => {
        const chosen = state.stage === current;
        return (
          <button
            key={state.stage}
            type="button"
            role="tab"
            aria-selected={chosen}
            onClick={() => onPick(state.stage)}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-body-sm font-semibold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-container ${
              chosen
                ? 'bg-primary-container text-space-deep'
                : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <span aria-hidden="true">{index + 1}</span>
            {STEP_NAMES[state.stage]}
            {state.done && <Check aria-label="written" className="h-4 w-4" />}
          </button>
        );
      })}
    </div>
  );
}

interface RunProps {
  readonly about: string;
  readonly state: StageState | undefined;
  readonly busy: boolean;
  readonly onRun: () => void;
}

/** What a step does, in one line, and the button that has an AI write it. */
export function StepRun({ about, state, busy, onRun }: RunProps) {
  const stage = state?.stage ?? 'hooks';
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-body-sm text-on-surface-variant">{about}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || state === undefined || state.blocked !== null}
          onClick={onRun}
          className={PRIMARY_BUTTON}
        >
          {state?.done ? `${ACTIONS[stage]} again` : ACTIONS[stage]}
        </button>
        {state?.blocked && <span className="text-body-sm text-outline">{state.blocked}</span>}
      </div>
    </div>
  );
}

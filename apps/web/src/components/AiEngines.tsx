import { aiBadge } from '../lib/aiBadge';
import {
  ENGINE_CHOICES,
  choiceFrom,
  choiceHelp,
  type EngineChoice,
  type EngineReport,
} from '../lib/analyses';
import { EngineStatusLine } from './AiBadge';
import { EngineSwitch } from './EngineSwitch';
import { FIELD } from './LabStatus';

/** The engine choice and what the server knows of the engines, as Settings needs them. */
export interface AiChoice {
  readonly choice: EngineChoice;
  readonly engines: EngineReport | null;
  /** An AI run is under way, so the choice waits until it is done. */
  readonly busy: boolean;
  readonly choose: (choice: EngineChoice) => void;
}

/** The engine choice as a compact list for a side panel, with what the choice means under it. */
export function EngineSelect({ ai }: { readonly ai: AiChoice }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <select
        aria-label="Which AI answers"
        value={ai.choice}
        disabled={ai.busy}
        onChange={(event) => ai.choose(choiceFrom(event.target.value))}
        className={FIELD}
      >
        {ENGINE_CHOICES.map((option) => (
          <option key={option.choice} value={option.choice}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-body-sm text-outline">{choiceHelp(ai.choice, ai.engines)}</p>
    </div>
  );
}

/** Which AI answers: the switch, what the choice means, and each engine as ready or not set up. */
export function AiEngines({ ai }: { readonly ai: AiChoice }) {
  const badge = aiBadge(ai.choice, ai.engines);
  return (
    <section aria-labelledby="settings-ai" className="flex flex-col gap-3">
      <h3 id="settings-ai" className="text-headline-md text-on-surface">
        Which AI answers
      </h3>
      <p className="text-body-sm text-on-surface-variant">
        {badge.summary} This choice is used by Ask AI, breakdowns, the idea lab and the script
        writer. What viewers ask for and Check before publishing always take the first engine that
        is ready. Every answer says which engine gave it.
      </p>
      <EngineSwitch choice={ai.choice} engines={ai.engines} busy={ai.busy} onChoose={ai.choose} />
      {badge.lines.length > 0 && (
        <ul className="flex max-w-md flex-col gap-1.5 rounded bg-surface-card p-space-md text-body-sm">
          {badge.lines.map((line) => (
            <EngineStatusLine key={line.id} line={line} />
          ))}
        </ul>
      )}
    </section>
  );
}

import { aiBadge } from '../lib/aiBadge';
import type { EngineChoice, EngineReport } from '../lib/analyses';
import { EngineStatusLine } from './AiBadge';
import { EngineSwitch } from './EngineSwitch';

/** The engine choice and what the server knows of the engines, as Settings needs them. */
export interface AiChoice {
  readonly choice: EngineChoice;
  readonly engines: EngineReport | null;
  /** An AI run is under way, so the choice waits until it is done. */
  readonly busy: boolean;
  readonly choose: (choice: EngineChoice) => void;
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

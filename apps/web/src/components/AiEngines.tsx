import { aiBadge } from '../lib/aiBadge';
import {
  ENGINE_CHOICES,
  choiceFrom,
  choiceHelp,
  type EngineChoice,
  type EngineId,
  type EngineReport,
} from '../lib/analyses';
import type { PictureCheck } from '../lib/pictureCheck';
import { PictureChecks } from './PictureChecks';
import { EngineStatusLine } from './AiBadge';
import { EngineSwitch } from './EngineSwitch';
import { Details } from './layout/Details';
import { FIELD } from './LabStatus';

/** The engine choice and what the server knows of the engines, as Settings needs them. */
export interface AiChoice {
  readonly choice: EngineChoice;
  readonly engines: EngineReport | null;
  /** An AI run is under way, so the choice waits until it is done. */
  readonly busy: boolean;
  readonly choose: (choice: EngineChoice) => void;
  /** Runs the picture check on one engine; absent where it is not offered. */
  readonly checkPictures?: (engine: EngineId) => Promise<PictureCheck>;
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

/** Which AI answers: the switch, each engine as ready or not set up, and what the choice covers. */
export function AiEngines({ ai }: { readonly ai: AiChoice }) {
  const badge = aiBadge(ai.choice, ai.engines);
  return (
    <section aria-labelledby="settings-ai" className="flex min-w-0 flex-col gap-space-sm">
      <h3 id="settings-ai" className="text-label text-outline">
        Which AI answers
      </h3>
      <EngineSwitch choice={ai.choice} engines={ai.engines} busy={ai.busy} onChoose={ai.choose} />
      <p className="text-body-sm text-primary">
        Kept as soon as you press it, in this browser. It needs no Save.
      </p>
      {badge.lines.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-surface-card p-space-md text-body-sm">
          {badge.lines.map((line) => (
            <EngineStatusLine key={line.id} line={line} />
          ))}
        </ul>
      )}
      {ai.checkPictures && (
        <PictureChecks report={ai.engines} busy={ai.busy} check={ai.checkPictures} />
      )}
      <Details summary="What this choice covers">
        <p className="text-body-sm text-on-surface-variant">
          {badge.summary} This choice is used by Ask AI, breakdowns, the idea lab and the script
          writer. What viewers ask for and Check before publishing always take the first engine that
          is ready. Every answer says which engine gave it.
        </p>
      </Details>
    </section>
  );
}

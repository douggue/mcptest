import { readyEngines } from '../lib/aiBadge';
import {
  AUTOMATIC,
  ENGINE_CHOICES,
  choiceHelp,
  type EngineChoice,
  type EngineReport,
} from '../lib/analyses';

interface SwitchProps {
  readonly choice: EngineChoice;
  readonly engines: EngineReport | null;
  readonly busy: boolean;
  readonly onChoose: (choice: EngineChoice) => void;
}

/** The switch for which AI answers: Automatic, or one engine and nothing else. */
export function EngineSwitch({ choice, engines, busy, onChoose }: SwitchProps) {
  // An engine that is not set up cannot answer, so it cannot be chosen until it is.
  const ready = readyEngines(engines);
  const notReady = (option: (typeof ENGINE_CHOICES)[number]): boolean =>
    engines !== null && option.choice !== AUTOMATIC && !ready.has(option.choice);
  const unready = ENGINE_CHOICES.filter(notReady).map((option) => option.label);
  return (
    <div className="flex flex-col gap-1">
      <div
        role="radiogroup"
        aria-label="Which AI answers"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="text-label text-outline">AI</span>
        {ENGINE_CHOICES.map((option) => {
          const chosen = option.choice === choice;
          return (
            <button
              key={option.choice}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={busy || notReady(option)}
              title={notReady(option) ? 'Set up first' : undefined}
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
      {unready.length > 0 && (
        <p className="text-body-sm text-outline">
          {unready.join(' and ')}: set up first, under Programs on this computer.
        </p>
      )}
    </div>
  );
}

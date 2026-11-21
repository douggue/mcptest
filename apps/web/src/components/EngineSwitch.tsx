import { ENGINE_CHOICES, choiceHelp, type EngineChoice, type EngineReport } from '../lib/analyses';

interface SwitchProps {
  readonly choice: EngineChoice;
  readonly engines: EngineReport | null;
  readonly busy: boolean;
  readonly onChoose: (choice: EngineChoice) => void;
}

/** The switch for which AI answers: Automatic, or one engine and nothing else. */
export function EngineSwitch({ choice, engines, busy, onChoose }: SwitchProps) {
  return (
    <div className="flex flex-col gap-1">
      <div
        role="radiogroup"
        aria-label="Which AI answers"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="text-label-caps uppercase text-outline">AI</span>
        {ENGINE_CHOICES.map((option) => {
          const chosen = option.choice === choice;
          return (
            <button
              key={option.choice}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={busy}
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
    </div>
  );
}

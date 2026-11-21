interface Option<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface Props<T extends string> {
  readonly label: string;
  readonly options: readonly Option<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly disabled?: boolean;
  /** Fill the width, each option an equal share, as in a side panel. */
  readonly fill?: boolean;
}

/** A row of options of which one is chosen, drawn as joined buttons. */
export function Segmented<T extends string>(props: Props<T>) {
  const { label, options, value, onChange, disabled, fill } = props;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`${fill ? 'grid auto-cols-fr grid-flow-col' : 'inline-flex flex-wrap'} min-w-0 gap-1 rounded-lg border border-border-subtle bg-space-deep p-1`}
    >
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`min-h-9 rounded-md px-3 text-body-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              chosen
                ? 'bg-primary-container text-space-deep'
                : 'text-on-surface-variant hover:bg-surface-card hover:text-on-surface'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

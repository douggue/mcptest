import type { Scope } from '../lib/feed';

interface Props {
  readonly scope: Scope;
  readonly onChange: (scope: Scope) => void;
  readonly peerCount: number;
  readonly totalCount: number;
}

/** Switches the screen between channels like the centre and everything YouTube showed nearby. */
export function ScopeToggle({ scope, onChange, peerCount, totalCount }: Props) {
  const options = [
    { id: 'peers' as const, label: 'Like yours', count: peerCount },
    { id: 'all' as const, label: 'Everything', count: totalCount },
  ];
  return (
    <div
      role="group"
      aria-label="Which channels to show"
      className="absolute left-6 top-5 z-40 flex items-center gap-1 rounded-full bg-surface-card/90 p-1 shadow-lg backdrop-blur-md"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={scope === option.id}
          disabled={option.count === 0}
          onClick={() => onChange(option.id)}
          className={`rounded-full px-3 py-1.5 text-label-caps transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            scope === option.id
              ? 'bg-primary-container font-semibold text-on-primary'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          {option.label} · {option.count}
        </button>
      ))}
    </div>
  );
}

import type { Scope } from '../lib/feed';

interface Props {
  readonly scope: Scope;
  readonly onChange: (scope: Scope) => void;
  readonly peerCount: number;
  readonly totalCount: number;
}

/**
 * Switches the screen between channels like the centre and everything
 * YouTube showed nearby, drawn as joined buttons like the other choices of
 * one. A side with no channels cannot be chosen.
 */
export function ScopeToggle({ scope, onChange, peerCount, totalCount }: Props) {
  const options = [
    { id: 'peers' as const, label: 'Like yours', count: peerCount },
    { id: 'all' as const, label: 'Everything', count: totalCount },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Which channels to show"
      className="inline-flex min-w-0 flex-wrap gap-1 rounded-lg border border-border-subtle bg-space-deep p-1"
    >
      {options.map((option) => {
        const chosen = scope === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={chosen}
            disabled={option.count === 0}
            onClick={() => onChange(option.id)}
            className={`min-h-9 rounded-md px-3 text-body-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              chosen
                ? 'border border-line-2 bg-white/[0.12] text-white'
                : 'text-on-surface-variant hover:bg-surface-card hover:text-on-surface'
            }`}
          >
            {option.label} · {option.count}
          </button>
        );
      })}
    </div>
  );
}

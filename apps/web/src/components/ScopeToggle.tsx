import type { Scope } from '../lib/feed';

interface Props {
  readonly scope: Scope;
  readonly onChange: (scope: Scope) => void;
  readonly peerCount: number;
  readonly totalCount: number;
  /** The split of the look-alikes into taken off, rising and neither, in words; null when there are none. */
  readonly mix: string | null;
}

/** Switches the screen between channels like the centre and everything YouTube showed nearby. */
export function ScopeToggle({ scope, onChange, peerCount, totalCount, mix }: Props) {
  const options = [
    { id: 'peers' as const, label: 'Like yours', count: peerCount },
    { id: 'all' as const, label: 'Everything', count: totalCount },
  ];
  return (
    <div className="absolute left-6 top-5 z-40 flex max-w-[calc(100%-3rem)] flex-col items-start gap-1.5">
      <div
        role="group"
        aria-label="Which channels to show"
        className="flex items-center gap-1 rounded-full bg-surface-card/90 p-1 shadow-lg backdrop-blur-md"
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
      {mix && (
        <p
          className="rounded-full bg-surface-card/90 px-3 py-1 text-label-caps text-on-surface-variant shadow-lg backdrop-blur-md"
          title="Channels like yours are listed about seven that have already taken off to three that are rising, as far as the map has them. Taken off: three or more uploads in the last 90 days passed 10K views, 100K views in all and at least one per subscriber. Rising: under three months old and already far above its size, with small totals so far."
        >
          {mix}
        </p>
      )}
    </div>
  );
}

import { Search } from 'lucide-react';
import { FIELD } from './LabStatus';

interface Entry {
  /** A style the AI named; null for all of them. */
  readonly style: string | null;
  readonly count: number;
}

interface Props {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly styles: readonly Entry[];
  readonly chosen: string | null;
  readonly onChoose: (style: string | null) => void;
}

/** One style to filter by, drawn as a tab-like button. */
function StyleButton({
  entry,
  chosen,
  onChoose,
}: {
  readonly entry: Entry;
  readonly chosen: boolean;
  readonly onChoose: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onChoose}
      className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-body-sm transition-colors ${
        chosen
          ? 'border-on-surface bg-on-surface font-semibold text-space-deep'
          : 'border-border-subtle text-on-surface-variant hover:bg-surface-card hover:text-on-surface'
      }`}
    >
      {entry.style ?? 'All'} <span className={chosen ? '' : 'text-outline'}>{entry.count}</span>
    </button>
  );
}

/** Search the hooks, and filter them by the style the AI named. */
export function HookFilters({ query, onQuery, styles, chosen, onChoose }: Props) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-space-sm">
      <label className="relative block min-w-0 flex-1 basis-64 lg:max-w-sm">
        <span className="sr-only">Search the hooks</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-2 h-4 w-4 text-outline"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search the words and the titles"
          className={`${FIELD} pl-9`}
        />
      </label>
      {styles.length > 1 && (
        <div
          role="group"
          aria-label="Filter by style"
          className="flex min-w-0 flex-wrap items-center gap-1.5"
        >
          {styles.map((entry) => (
            <StyleButton
              key={entry.style ?? 'all'}
              entry={entry}
              chosen={chosen === entry.style}
              onChoose={() => onChoose(entry.style)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

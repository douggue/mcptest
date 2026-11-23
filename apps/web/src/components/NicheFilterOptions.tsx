import type { ReactNode } from 'react';
import type { FilterGroup, FilterOption } from '../lib/nicheFilters';

interface Props {
  readonly group: FilterGroup;
  readonly options: readonly FilterOption[];
  /** How many channels each option would keep, given the other filters. */
  readonly counts: ReadonlyMap<string, number>;
  readonly chosen: readonly string[];
  readonly onToggle: (key: string) => void;
  /** Shortcuts or a note under the options, such as the monetization check. */
  readonly extra?: ReactNode;
}

/** One option to choose or let go, with how many channels it would keep. */
function OptionChip({
  option,
  count,
  chosen,
  onToggle,
}: {
  readonly option: FilterOption;
  readonly count: number;
  readonly chosen: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onToggle}
      className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-body-sm transition-colors ${
        chosen
          ? 'border-primary-container bg-primary-container font-semibold text-space-deep'
          : 'border-border-subtle text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
      }`}
    >
      <span className="min-w-0 break-words text-left">{option.label}</span>
      <span className={chosen ? '' : 'text-outline'}>{count}</span>
    </button>
  );
}

/** A filter group's options as chips, with the note on where its numbers come from. */
export function NicheFilterOptions({ group, options, counts, chosen, onToggle, extra }: Props) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-body-sm font-semibold text-on-surface">{group.label}</legend>
      <p className="text-label text-outline">{group.note}</p>
      {options.length === 0 ? (
        <p className="text-body-sm text-outline">None of the channels listed has this yet.</p>
      ) : (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {options.map((option) => (
            <OptionChip
              key={option.key}
              option={option}
              count={counts.get(option.key) ?? 0}
              chosen={chosen.includes(option.key)}
              onToggle={() => onToggle(option.key)}
            />
          ))}
        </div>
      )}
      {extra}
    </fieldset>
  );
}

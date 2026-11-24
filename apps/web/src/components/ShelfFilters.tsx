import type { Ingredient } from '@jgtube/core';
import { Search } from 'lucide-react';
import {
  INGREDIENT_LAYERS,
  LAYER_LABELS,
  SOURCE_LABELS,
  layerCounts,
  sourcesOn,
  type ShelfFilter,
  type ShelfSort,
} from '../lib/formatShelf';
import { Field } from './layout/Card';
import { Segmented } from './layout/Segmented';
import { FIELD } from './LabStatus';

interface Props {
  readonly items: readonly Ingredient[];
  readonly filter: ShelfFilter;
  readonly onChange: (filter: ShelfFilter) => void;
}

const SORTS: readonly { readonly value: ShelfSort; readonly label: string }[] = [
  { value: 'proven', label: 'Proven first' },
  { value: 'newest', label: 'Newest' },
];

function Chip({
  chosen,
  onClick,
  children,
}: {
  readonly chosen: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onClick}
      className={`min-h-9 whitespace-nowrap rounded-lg border px-3 py-1 text-body-sm transition-colors ${
        chosen
          ? 'border-on-surface bg-on-surface font-semibold text-space-deep'
          : 'border-border-subtle text-on-surface-variant hover:bg-surface-card hover:text-on-surface'
      }`}
    >
      {children}
    </button>
  );
}

/** The shelf's search, order, layer chips with counts, and the sources there are. */
export function ShelfFilters({ items, filter, onChange }: Props) {
  const counts = layerCounts(items);
  const sources = sourcesOn(items);
  return (
    <>
      <label className="relative block min-w-0">
        <span className="sr-only">Search the shelf</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-outline"
        />
        <input
          type="search"
          value={filter.query}
          onChange={(event) => onChange({ ...filter, query: event.target.value })}
          placeholder="Search names and notes"
          maxLength={100}
          className={`${FIELD} pl-10`}
        />
      </label>
      <Segmented
        label="Order"
        options={SORTS}
        value={filter.sort}
        onChange={(sort) => onChange({ ...filter, sort })}
        fill
      />
      <Field label="Layer">
        <div className="flex min-w-0 flex-wrap gap-2">
          <Chip chosen={filter.layer === null} onClick={() => onChange({ ...filter, layer: null })}>
            All <span className="text-outline">{items.length}</span>
          </Chip>
          {INGREDIENT_LAYERS.filter((layer) => counts[layer] > 0).map((layer) => (
            <Chip
              key={layer}
              chosen={filter.layer === layer}
              onClick={() => onChange({ ...filter, layer })}
            >
              {LAYER_LABELS[layer]} <span className="text-outline">{counts[layer]}</span>
            </Chip>
          ))}
        </div>
      </Field>
      {sources.length > 1 && (
        <Field label="From">
          <div className="flex min-w-0 flex-wrap gap-2">
            <Chip
              chosen={filter.source === null}
              onClick={() => onChange({ ...filter, source: null })}
            >
              Anywhere
            </Chip>
            {sources.map((source) => (
              <Chip
                key={source}
                chosen={filter.source === source}
                onClick={() => onChange({ ...filter, source })}
              >
                {SOURCE_LABELS[source]}
              </Chip>
            ))}
          </div>
        </Field>
      )}
    </>
  );
}

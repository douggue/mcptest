import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { FILTER_GROUPS, activeCount, clearFilters, withSort } from '../lib/nicheFilters';
import { NICHE_SORTS, isNicheSort } from '../lib/nicheSort';
import { BottomSheet } from './layout/BottomSheet';
import { Popover } from './layout/Popover';
import { NicheFilterGroup, type NicheFilterModel } from './NicheFilterGroup';
import { useNarrow } from './useNarrow';

const LINK = 'rounded text-body-sm font-semibold text-primary hover:underline';

/** How the list is ordered, as a plain select. */
function SortSelect({ model }: { readonly model: NicheFilterModel }) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-body-sm text-outline">
      Sort
      <select
        value={model.state.sort}
        onChange={(event) => {
          const sort = event.target.value;
          if (isNicheSort(sort)) model.update((state) => withSort(state, sort));
        }}
        className="min-h-10 min-w-0 rounded-full border border-border-subtle bg-space-deep px-3 text-body-sm text-on-surface"
      >
        {NICHE_SORTS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One button per filter, each opening a small popover; one open at a time. */
function FilterButtons({ model }: { readonly model: NicheFilterModel }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      {FILTER_GROUPS.map((group) => {
        const chosen = model.state.chosen[group.id].length;
        return (
          <Popover
            key={group.id}
            label={chosen > 0 ? `${group.label} · ${chosen}` : group.label}
            active={chosen > 0}
            open={openId === group.id}
            onOpenChange={(open) => setOpenId(open ? group.id : null)}
          >
            <NicheFilterGroup model={model} groupId={group.id} />
          </Popover>
        );
      })}
    </>
  );
}

/** On a phone: one "Filters" button opening every group in a sheet from the foot. */
function FilterSheet({ model }: { readonly model: NicheFilterModel }) {
  const [open, setOpen] = useState(false);
  const count = activeCount(model.state);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-body-sm ${
          count > 0
            ? 'border-primary-container bg-primary-container/15 font-semibold text-primary'
            : 'border-border-subtle text-on-surface-variant'
        }`}
      >
        <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
        Filters{count > 0 ? ` (${count})` : ''}
      </button>
      <BottomSheet
        title="Filters"
        open={open}
        onClose={() => setOpen(false)}
        footer={
          count > 0 ? (
            <button type="button" className={LINK} onClick={() => model.update(clearFilters)}>
              Clear filters
            </button>
          ) : undefined
        }
      >
        {FILTER_GROUPS.map((group) => (
          <NicheFilterGroup key={group.id} model={model} groupId={group.id} />
        ))}
      </BottomSheet>
    </>
  );
}

interface Props {
  readonly model: NicheFilterModel;
  /** How many channels the filters keep. */
  readonly shown: number;
}

/** The filters, the order, and how many of the channels in view they keep. */
export function NicheFilterBar({ model, shown }: Props) {
  const narrow = useNarrow();
  const count = activeCount(model.state);
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <div
        role="group"
        aria-label="Filter the channels"
        className="flex min-w-0 flex-wrap items-center gap-2"
      >
        {narrow ? <FilterSheet model={model} /> : <FilterButtons model={model} />}
        <SortSelect model={model} />
      </div>
      <p className="flex min-w-0 flex-wrap items-center gap-x-3 text-body-sm text-outline">
        <span aria-live="polite">
          Showing {shown} of {model.channels.length}
        </span>
        {count > 0 && (
          <button type="button" className={LINK} onClick={() => model.update(clearFilters)}>
            Clear filters
          </button>
        )}
      </p>
    </div>
  );
}

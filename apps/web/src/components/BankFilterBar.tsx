import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { BANK_GROUPS, type BankGroupId } from '@jgtube/core/src/bank/filters';
import { BANK_SORTS, isBankSort, type BankPage } from '@jgtube/core/src/bank/query';
import { activeBankFilters, clearBankFilters, toggleBankChoice } from '../lib/bank';
import { BottomSheet } from './layout/BottomSheet';
import { Popover } from './layout/Popover';
import type { BankModel } from './useBank';
import { useNarrow } from './useNarrow';

const LINK = 'rounded text-body-sm font-semibold text-primary hover:underline';
const FIELD =
  'min-h-10 w-full min-w-0 rounded-full border border-border-subtle bg-space-deep px-3 text-body-sm text-on-surface placeholder:text-outline';

/** One group's options as chips, each with how many videos it would keep given the other groups. */
function GroupOptions({
  model,
  groupId,
}: {
  readonly model: BankModel;
  readonly groupId: BankGroupId;
}) {
  const group = BANK_GROUPS.find((one) => one.id === groupId);
  const options = model.page?.options[groupId] ?? [];
  if (!group) return null;
  const chosen = model.state.chosen[groupId];
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-body-sm font-semibold text-on-surface">{group.label}</legend>
      <p className="text-label text-outline">{group.note}</p>
      {options.length === 0 ? (
        <p className="text-body-sm text-outline">
          {groupId === 'collection'
            ? 'No collections yet: save a video to one.'
            : 'Nothing to choose yet.'}
        </p>
      ) : (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {options.map((option) => {
            const on = chosen.includes(option.key);
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  model.update((state) => toggleBankChoice(state, groupId, option.key))
                }
                className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-body-sm transition-colors ${
                  on
                    ? 'border-primary-container bg-primary-container font-semibold text-space-deep'
                    : 'border-border-subtle text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                }`}
              >
                <span className="min-w-0 break-words text-left">{option.label}</span>
                <span className={on ? '' : 'text-outline'}>
                  {option.count.toLocaleString('en')}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function FilterButtons({ model }: { readonly model: BankModel }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      {BANK_GROUPS.map((group) => {
        const chosen = model.state.chosen[group.id].length;
        return (
          <Popover
            key={group.id}
            label={chosen > 0 ? `${group.label} · ${chosen}` : group.label}
            active={chosen > 0}
            open={openId === group.id}
            onOpenChange={(open) => setOpenId(open ? group.id : null)}
          >
            <GroupOptions model={model} groupId={group.id} />
          </Popover>
        );
      })}
    </>
  );
}

function FilterSheet({ model }: { readonly model: BankModel }) {
  const [open, setOpen] = useState(false);
  const count = activeBankFilters(model.state);
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
            <button type="button" className={LINK} onClick={() => model.update(clearBankFilters)}>
              Clear filters
            </button>
          ) : undefined
        }
      >
        {BANK_GROUPS.map((group) => (
          <GroupOptions key={group.id} model={model} groupId={group.id} />
        ))}
      </BottomSheet>
    </>
  );
}

/** The title words to keep and to leave out. */
function TitleWords({ model }: { readonly model: BankModel }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="flex min-w-0 flex-col gap-1 text-body-sm text-outline">
        Title contains
        <input
          type="search"
          value={model.state.contains}
          maxLength={100}
          placeholder="Words every title has"
          onChange={(event) => {
            const contains = event.target.value;
            model.update((state) => ({ ...state, contains }));
          }}
          className={FIELD}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-body-sm text-outline">
        Title excludes
        <input
          type="search"
          value={model.state.excludes}
          maxLength={100}
          placeholder="Words no title has"
          onChange={(event) => {
            const excludes = event.target.value;
            model.update((state) => ({ ...state, excludes }));
          }}
          className={FIELD}
        />
      </label>
    </div>
  );
}

function SortSelect({ model }: { readonly model: BankModel }) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-body-sm text-outline">
      Sort
      <select
        value={model.state.sort}
        onChange={(event) => {
          const sort = event.target.value;
          if (isBankSort(sort)) model.update((state) => ({ ...state, sort }));
        }}
        className="min-h-10 min-w-0 rounded-full border border-border-subtle bg-space-deep px-3 text-body-sm text-on-surface"
      >
        {BANK_SORTS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Counts({ model, page }: { readonly model: BankModel; readonly page: BankPage | null }) {
  const count = activeBankFilters(model.state);
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-3 text-body-sm text-outline">
      <span aria-live="polite">
        {page
          ? `Showing ${page.matched.toLocaleString('en')} of ${page.total.toLocaleString('en')}`
          : 'Reading the bank…'}
      </span>
      {count > 0 && (
        <button type="button" className={LINK} onClick={() => model.update(clearBankFilters)}>
          Clear filters
        </button>
      )}
    </p>
  );
}

/** The bank's filters (as on New niches), the title words, the order, and how many they keep. */
export function BankFilterBar({ model }: { readonly model: BankModel }) {
  const narrow = useNarrow();
  return (
    <div className="flex min-w-0 flex-col gap-space-sm">
      <div
        role="group"
        aria-label="Filter the outliers"
        className="flex min-w-0 flex-wrap items-center gap-2"
      >
        {narrow ? <FilterSheet model={model} /> : <FilterButtons model={model} />}
        <SortSelect model={model} />
      </div>
      <TitleWords model={model} />
      <Counts model={model} page={model.page} />
    </div>
  );
}

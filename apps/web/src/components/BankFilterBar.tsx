import { SlidersHorizontal } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BANK_GROUPS, type BankGroupId } from '@jgtube/core/src/bank/filters';
import { BANK_SORTS, isBankSort, type BankSort } from '@jgtube/core/src/bank/query';
import { activeBankFilters, clearBankFilters, toggleBankChoice } from '../lib/bank';
import { FilterBar, SearchField, ShownLine } from './discover/FilterBar';
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
                    ? 'border-line-2 bg-white/[0.14] font-semibold text-white'
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

/** The filters shown as chips of their own; the rest sit together under "More filters". */
const MAIN_GROUPS: ReadonlySet<BankGroupId> = new Set([
  'score',
  'age',
  'size',
  'money',
  'language',
  'length',
]);
const MORE = 'more';

function FilterButtons({ model }: { readonly model: BankModel }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rest = BANK_GROUPS.filter((group) => !MAIN_GROUPS.has(group.id));
  const restChosen = rest.reduce((sum, group) => sum + model.state.chosen[group.id].length, 0);
  return (
    <>
      {BANK_GROUPS.filter((group) => MAIN_GROUPS.has(group.id)).map((group) => {
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
      <Popover
        label={restChosen > 0 ? `More filters · ${restChosen}` : 'More filters'}
        active={restChosen > 0}
        open={openId === MORE}
        onOpenChange={(open) => setOpenId(open ? MORE : null)}
      >
        <div className="flex max-h-[60vh] min-w-0 flex-col gap-space-md overflow-y-auto">
          {rest.map((group) => (
            <GroupOptions key={group.id} model={model} groupId={group.id} />
          ))}
        </div>
      </Popover>
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
        className={`flex h-[38px] items-center gap-1.5 rounded-md border px-3 text-body-sm ${
          count > 0
            ? 'border-line-2 bg-white/[0.12] font-semibold text-white'
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

/** Words no title shown may hold, in a chip's menu. */
function WithoutWords({ model }: { readonly model: BankModel }) {
  const [open, setOpen] = useState(false);
  const { excludes } = model.state;
  return (
    <Popover
      label={excludes.trim() === '' ? 'Without words' : `Without: ${excludes.trim()}`}
      active={excludes.trim() !== ''}
      open={open}
      onOpenChange={setOpen}
    >
      <label className="flex min-w-0 flex-col gap-2 text-body-sm font-semibold text-ink">
        Title excludes
        <input
          type="search"
          value={excludes}
          maxLength={100}
          placeholder="Words no title has"
          onChange={(event) => {
            const next = event.target.value;
            model.update((state) => ({ ...state, excludes: next }));
          }}
          className={FIELD}
        />
      </label>
    </Popover>
  );
}

function SortSelect({ model }: { readonly model: BankModel }) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-body-sm text-dim">
      <span className="sr-only">Sort</span>
      <select
        value={model.state.sort}
        onChange={(event) => {
          const sort = event.target.value;
          if (isBankSort(sort)) model.update((state) => ({ ...state, sort }));
        }}
        className="h-[38px] min-w-0 rounded-md border border-line bg-ground px-3 text-body-sm text-ink"
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

/** The order the videos are shown in, in words, for the line at the right of the bar. */
const sortWords = (sort: BankSort): string =>
  `${BANK_SORTS.find((option) => option.id === sort)?.label ?? ''} first`;

interface Props {
  readonly model: BankModel;
  /** Controls that sit with the filters, such as "Find more" and "Save this view". */
  readonly extras?: ReactNode;
}

/**
 * The bank's one filter bar: the title search, each filter as a chip with
 * live counts (one sheet of them on a phone), the sort, and how many are
 * shown. Choices in one filter are joined by OR; filters are joined by AND.
 */
export function BankFilterBar({ model, extras }: Props) {
  const narrow = useNarrow();
  const { page } = model;
  const count = activeBankFilters(model.state);
  return (
    <FilterBar label="Filter the videos">
      <SearchField
        label="Words in the title"
        placeholder="Search titles"
        value={model.state.contains}
        onChange={(contains) => model.update((state) => ({ ...state, contains }))}
      />
      {narrow ? <FilterSheet model={model} /> : <FilterButtons model={model} />}
      <WithoutWords model={model} />
      <SortSelect model={model} />
      {extras}
      <ShownLine
        text={
          page
            ? `Showing ${page.matched.toLocaleString('en')} of ${page.total.toLocaleString('en')} · ${sortWords(model.state.sort)}`
            : 'Reading the bank…'
        }
        onClear={count > 0 ? () => model.update(clearBankFilters) : undefined}
      />
    </FilterBar>
  );
}

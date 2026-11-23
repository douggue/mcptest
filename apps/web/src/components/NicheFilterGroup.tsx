import type { NicheChannel } from '@jgtube/core';
import { MAX_CHECK_IDS } from '../lib/money';
import {
  FILTER_GROUPS,
  groupOptions,
  optionCounts,
  setChoice,
  toggleChoice,
  uncheckedIds,
  type FilterContext,
  type FilterGroupId,
  type FilterOption,
  type NicheFilterState,
} from '../lib/nicheFilters';
import { MoneyCheck } from './MoneyCheck';
import { NicheFilterOptions } from './NicheFilterOptions';

/** What every filter control works on: the list in view, the choice, and how to change it. */
export interface NicheFilterModel {
  readonly channels: readonly NicheChannel[];
  readonly state: NicheFilterState;
  readonly update: (change: (state: NicheFilterState) => NicheFilterState) => void;
  readonly context: FilterContext;
}

const SHORTCUT =
  'min-h-9 rounded-full px-3 text-body-sm text-primary transition-colors hover:bg-surface-container-high';

/** One-press choices of Latin titles only, or of every other alphabet on the list. */
function LanguageShortcuts({
  model,
  options,
}: {
  readonly model: NicheFilterModel;
  readonly options: readonly FilterOption[];
}) {
  const others = options.map((option) => option.key).filter((key) => key !== 'latin');
  if (others.length === 0) return null;
  const choose = (keys: readonly string[]) =>
    model.update((state) => setChoice(state, 'language', keys));
  return (
    <div className="flex flex-wrap gap-1">
      <button type="button" className={SHORTCUT} onClick={() => choose(['latin'])}>
        Latin letters only
      </button>
      <button type="button" className={SHORTCUT} onClick={() => choose(others)}>
        Other alphabets only
      </button>
    </div>
  );
}

/** How many channels were never checked for money, and a way to check some of them. */
function MoneyUnchecked({ model }: { readonly model: NicheFilterModel }) {
  const unchecked = uncheckedIds(model.channels, model.state, model.context);
  if (unchecked.length === 0) return null;
  const chosen = model.state.chosen.money;
  const leftOut = chosen.length > 0 && !chosen.includes('not-checked');
  const noun = unchecked.length === 1 ? 'channel is' : 'channels are';
  const next = unchecked.slice(0, MAX_CHECK_IDS);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-body-sm text-outline">
        {unchecked.length} {noun} not checked yet{leftOut ? ' and left out' : ''}.
      </p>
      <MoneyCheck channelIds={next} label={`Check ${next.length} of them`} />
    </div>
  );
}

/** One filter group, ready for a popover or the phone's sheet. */
export function NicheFilterGroup({
  model,
  groupId,
}: {
  readonly model: NicheFilterModel;
  readonly groupId: FilterGroupId;
}) {
  const group = FILTER_GROUPS.find((one) => one.id === groupId);
  if (!group) return null;
  const options = groupOptions(model.channels, groupId, model.context);
  const extra =
    groupId === 'language' ? (
      <LanguageShortcuts model={model} options={options} />
    ) : groupId === 'money' ? (
      <MoneyUnchecked model={model} />
    ) : undefined;
  return (
    <NicheFilterOptions
      group={group}
      options={options}
      counts={optionCounts(model.channels, model.state, groupId, model.context)}
      chosen={model.state.chosen[groupId]}
      onToggle={(key) => model.update((state) => toggleChoice(state, groupId, key))}
      extra={extra}
    />
  );
}

import { useEffect, useSyncExternalStore } from 'react';
import { createMoneyApi, type MoneyFilter } from '../lib/money';
import { createMoneyStore, type MoneyState } from '../lib/moneyStore';

/** One store for the whole page, so a check made anywhere shows on every badge. */
export const moneyStore = createMoneyStore(createMoneyApi());

/** Ids asked for in the same moment are read in one request. */
let pending = new Set<string>();
let flushing = false;
function ask(ids: readonly string[]): void {
  ids.forEach((id) => pending.add(id));
  if (flushing) return;
  flushing = true;
  setTimeout(() => {
    const wanted = [...pending];
    pending = new Set();
    flushing = false;
    void moneyStore.load(wanted);
  }, 0);
}

/** The verdicts the page holds, reading those of `ids` not read yet. */
export function useMoney(ids: readonly string[]): MoneyState {
  const key = ids.join(',');
  useEffect(() => {
    if (key !== '') ask(key.split(','));
  }, [key]);
  return useSyncExternalStore(moneyStore.subscribe, moneyStore.snapshot);
}

/** The lists that can be filtered by monetization, each keeping its own choice while the page is open. */
export type MoneyListView = 'niches' | 'same-topic' | 'breakouts';

let filters: Readonly<Record<MoneyListView, MoneyFilter>> = {
  niches: 'any',
  'same-topic': 'any',
  breakouts: 'any',
};
const filterListeners = new Set<() => void>();
const subscribeFilters = (listener: () => void): (() => void) => {
  filterListeners.add(listener);
  return () => {
    filterListeners.delete(listener);
  };
};

/** One list's monetization filter, shared by its side panel and its cards. */
export function useMoneyFilter(
  view: MoneyListView,
): readonly [MoneyFilter, (next: MoneyFilter) => void] {
  const value = useSyncExternalStore(subscribeFilters, () => filters[view]);
  const set = (next: MoneyFilter): void => {
    filters = { ...filters, [view]: next };
    filterListeners.forEach((listener) => listener());
  };
  return [value, set];
}

/** The items of a list that pass its monetization filter. */
export function useMoneyFiltered<T>(
  view: MoneyListView,
  items: readonly T[],
  idOf: (item: T) => string,
): readonly T[] {
  const [value] = useMoneyFilter(view);
  const { byId } = useMoney(items.map(idOf));
  if (value === 'any') return items;
  return items.filter((item) => byId.get(idOf(item))?.status === value);
}

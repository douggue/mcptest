/**
 * The New niches filters as kept in this browser, and read back. What is read
 * is not trusted: anything that is not a known option, or a short code for the
 * groups whose options come from the list, is dropped.
 */
import { FILTER_GROUPS, NO_FILTERS, type FilterGroup, type NicheFilterState } from './nicheFilters';
import { isNicheSort } from './nicheSort';

/** The browser key the choice is kept under; versioned so a new shape starts afresh. */
export const NICHE_FILTERS_KEY = 'jgtube.nicheFilters.v1';
/** Longer than any alphabet's or country's key; anything longer was not written by the page. */
const MAX_KEY_LENGTH = 40;
const MAX_KEYS = 50;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The keys of one group that the page could have written. */
function cleanKeys(group: FilterGroup, raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const allowed = group.options?.map((option) => option.key);
  const keys = raw
    .filter((key): key is string => typeof key === 'string' && key.length <= MAX_KEY_LENGTH)
    .filter((key) => (allowed ? allowed.includes(key) : key.length > 0))
    .slice(0, MAX_KEYS);
  const unique = [...new Set(keys)];
  return group.single ? unique.slice(0, 1) : unique;
}

/** The kept choice, or no filters when there is none or it cannot be read. */
export function parseSavedFilters(text: string | null): NicheFilterState {
  if (text === null) return NO_FILTERS;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NO_FILTERS;
  }
  if (!isRecord(raw)) return NO_FILTERS;
  const chosen = isRecord(raw['chosen']) ? raw['chosen'] : {};
  return {
    chosen: Object.fromEntries(
      FILTER_GROUPS.map((group) => [group.id, cleanKeys(group, chosen[group.id])]),
    ) as NicheFilterState['chosen'],
    sort: isNicheSort(raw['sort']) ? raw['sort'] : NO_FILTERS.sort,
  };
}

export const savedText = (state: NicheFilterState): string => JSON.stringify(state);

import { useCallback, useEffect, useState } from 'react';
import type { NicheFilterState } from '../lib/nicheFilters';
import { NICHE_FILTERS_KEY, parseSavedFilters, savedText } from '../lib/nicheFilterSave';

/** The kept choice; none when the browser keeps nothing or refuses to be read. */
function readSaved(): NicheFilterState {
  try {
    return parseSavedFilters(window.localStorage.getItem(NICHE_FILTERS_KEY));
  } catch {
    return parseSavedFilters(null);
  }
}

/** The New niches filters, remembered in this browser where it allows. */
export function useNicheFilters(): readonly [
  NicheFilterState,
  (change: (state: NicheFilterState) => NicheFilterState) => void,
] {
  const [state, setState] = useState<NicheFilterState>(readSaved);
  useEffect(() => {
    try {
      window.localStorage.setItem(NICHE_FILTERS_KEY, savedText(state));
    } catch {
      // A private window or blocked storage: the filters still work, they are just not kept.
    }
  }, [state]);
  const update = useCallback(
    (change: (state: NicheFilterState) => NicheFilterState) => setState(change),
    [],
  );
  return [state, update];
}

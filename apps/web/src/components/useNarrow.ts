import { useEffect, useState } from 'react';

/** Below this width the screen is a phone's. */
const NARROW_QUERY = '(max-width: 639px)';

const matches = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(NARROW_QUERY).matches
    : false;

/** Whether the screen is a phone's, following a turn or a resized window. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(NARROW_QUERY);
    const follow = (): void => setNarrow(list.matches);
    list.addEventListener('change', follow);
    return () => list.removeEventListener('change', follow);
  }, []);
  return narrow;
}

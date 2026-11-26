import { useState } from 'react';
import { withParts, type DataPart } from '../lib/dataParts';

/**
 * The slow reads wanted so far: those of every screen opened since the page
 * loaded. A part is added the moment its screen opens and is never taken
 * away, so what was read stays on hand.
 */
export function useWanted(parts: readonly DataPart[]): ReadonlySet<DataPart> {
  const [wanted, setWanted] = useState<ReadonlySet<DataPart>>(() => new Set(parts));
  const next = withParts(wanted, parts);
  // Adjusting state while drawing, as React allows for state that follows a prop.
  if (next !== wanted) setWanted(next);
  return next;
}

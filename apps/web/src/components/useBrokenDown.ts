import { useEffect, useMemo, useState } from 'react';
import { createBreakdownViewApi } from '../lib/videoBreakdown';

/**
 * When each of these channels was last broken down, by channel id, read
 * once per list. A channel never broken down is absent. A failed read shows
 * nothing rather than a wrong date.
 */
export function useBrokenDown(ids: readonly string[]): ReadonlyMap<string, string> {
  const api = useMemo(() => createBreakdownViewApi(), []);
  const [dates, setDates] = useState<ReadonlyMap<string, string>>(new Map());
  const key = ids.join(',');
  useEffect(() => {
    let current = true;
    const list = key === '' ? [] : key.split(',');
    api.candidates(list).then(
      (facts) => {
        if (!current) return;
        setDates(
          new Map(
            facts.flatMap((fact) =>
              fact.brokenDownAt === null ? [] : [[fact.id, fact.brokenDownAt] as const],
            ),
          ),
        );
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [api, key]);
  return dates;
}

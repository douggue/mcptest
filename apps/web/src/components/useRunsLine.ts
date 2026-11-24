import { useEffect, useMemo, useState } from 'react';
import { createTeardownApi, runsLine } from '../lib/teardown';

/** What a teardown of the video (or of any file) would take, in one line; null while unknown. */
export function useRunsLine(videoId: string | null): string | null {
  const api = useMemo(() => createTeardownApi(), []);
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    api
      .runs(videoId, false)
      .then((runs) => current && setLine(runsLine(runs)))
      .catch(() => current && setLine(null));
    return () => {
      current = false;
    };
  }, [api, videoId]);
  return line;
}

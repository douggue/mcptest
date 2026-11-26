import { useCallback, useEffect, useState } from 'react';
import type { StyleLockView } from '../lib/answersApi';
import type { FlowCounts } from '../lib/flow';
import { answersApi } from './useAnswers';

export interface Flow {
  /** What is stored at each step for the channel on screen; null until read, or with no map. */
  readonly counts: FlowCounts | null;
  /** The style lock the owner uses for this channel; null when none. */
  readonly styleLock: StyleLockView | null;
  /** Something the owner pressed that could not be done, in plain words. */
  readonly problem: string | null;
  readonly useStyleLock: (fromChannelId: string) => void;
  readonly stopStyleLock: () => void;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'It could not be done';

/**
 * The path through the page for the channel on screen: the counts the flow
 * strip shows, read again whenever `version` changes (a job finished), and
 * the style lock the owner chose for the channel.
 */
export function useFlow(
  centerId: string | null,
  version: string,
  /** The counts are read only once a screen that shows them has opened; the style lock always. */
  wanted = true,
): Flow {
  const [counts, setCounts] = useState<FlowCounts | null>(null);
  const [styleLock, setStyleLock] = useState<StyleLockView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    if (centerId === null) {
      setCounts(null);
      setStyleLock(null);
      return undefined;
    }
    answersApi
      .styleLock(centerId)
      .then((found) => current && setStyleLock(found))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [centerId, version]);

  useEffect(() => {
    let current = true;
    if (centerId === null || !wanted) return undefined;
    answersApi
      .flow(centerId)
      .then((found) => current && setCounts(found))
      .catch(() => current && setCounts(null));
    return () => {
      current = false;
    };
  }, [centerId, version, wanted]);

  const useStyleLock = useCallback(
    (fromChannelId: string) => {
      if (centerId === null) return;
      setProblem(null);
      answersApi
        .useStyleLock(centerId, fromChannelId)
        .then(setStyleLock)
        .catch((error: unknown) => setProblem(messageOf(error)));
    },
    [centerId],
  );
  const stopStyleLock = useCallback(() => {
    if (centerId === null) return;
    answersApi
      .stopStyleLock(centerId)
      .then(() => setStyleLock(null))
      .catch((error: unknown) => setProblem(messageOf(error)));
  }, [centerId]);

  return { counts, styleLock, problem, useStyleLock, stopStyleLock };
}

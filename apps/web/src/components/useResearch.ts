import { useCallback, useEffect, useState } from 'react';
import type { EngineChoice } from '../lib/analyses';
import type { LabApi } from '../lib/labApi';
import type { ResearchView } from '../lib/research';
import type { LabJobs } from './useLabJob';

export interface Research {
  /** The open concept's fact sheet and claims check; null until read. */
  readonly view: ResearchView | null;
  /** What the last claims check did, in one line; null before one. */
  readonly note: string | null;
  readonly research: () => void;
  /** Checks the next claims of the text the owner is looking at. */
  readonly checkClaims: (which: 'draft' | 'tightened') => void;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The research of the concept whose script is open: read when it opens, and
 * the two web runs that fill it, each a job in the lab's one slot.
 */
export function useResearch(
  api: LabApi,
  jobs: LabJobs,
  centerId: string | null,
  conceptId: number | null,
  engine: EngineChoice,
): Research {
  const [view, setView] = useState<ResearchView | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setView(null);
    setNote(null);
    if (centerId === null || conceptId === null) return undefined;
    let current = true;
    api
      .research(centerId, conceptId)
      .then((found) => current && setView(found))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [api, centerId, conceptId]);

  const { run } = jobs;
  const research = useCallback(() => {
    if (centerId === null || conceptId === null) return;
    run(
      { kind: 'research' },
      () => api.startResearch(centerId, conceptId, engine),
      (outcome) => {
        if (outcome.kind === 'research') {
          setView((now) => ({ sheet: outcome.sheet, claims: now?.claims ?? [] }));
        }
      },
    );
  }, [api, run, centerId, conceptId, engine]);

  const checkClaims = useCallback(
    (which: 'draft' | 'tightened') => {
      if (centerId === null || conceptId === null) return;
      run(
        { kind: 'claims' },
        () => api.startClaims(centerId, conceptId, which, engine),
        (outcome) => {
          if (outcome.kind !== 'claims') return;
          setView((now) => ({ sheet: now?.sheet ?? null, claims: outcome.claims }));
          setNote(
            `Checked ${plural(outcome.checked, 'claim')}. ${
              outcome.remaining === 0
                ? 'Every marked claim has been checked.'
                : `${plural(outcome.remaining, 'marked claim')} left to check.`
            }`,
          );
        },
      );
    },
    [api, run, centerId, conceptId, engine],
  );

  return { view, note, research, checkClaims };
}

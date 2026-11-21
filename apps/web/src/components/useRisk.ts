import { useCallback, useEffect, useMemo, useState } from 'react';
import { createExtrasApi } from '../lib/extrasApi';
import { requestCounter } from '../lib/requests';
import type { RiskView } from '../lib/risk';
import { follow, type Work } from './useComments';
import { useOnScreen, useReattach } from './useReattach';

const RISK_KINDS: readonly string[] = ['risk-check'];

export interface Risk {
  readonly view: RiskView | null;
  /** The concept whose script is shown; null when none has a script. */
  readonly conceptId: number | null;
  readonly choose: (conceptId: number) => void;
  readonly problem: string | null;
  readonly work: Work;
  readonly ask: () => void;
}

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/**
 * The risk check of one script: the concept the script writer has open, unless
 * the owner picks another here. Read again after a check and after a refresh.
 */
export function useRisk(
  channelId: string | null,
  openConceptId: number | null,
  reloadKey: unknown,
): Risk {
  const api = useMemo(() => createExtrasApi(), []);
  const requests = useMemo(() => requestCounter(), []);
  const [picked, setPicked] = useState<number | null>(null);
  const [view, setView] = useState<RiskView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [work, setWork] = useState<Work>({ status: 'idle' });
  const [turn, setTurn] = useState(0);
  useEffect(() => setPicked(null), [openConceptId, channelId]);
  const wanted = picked ?? openConceptId;

  useEffect(() => {
    if (channelId === null) {
      setView(null);
      return;
    }
    const isNewest = requests.begin();
    api
      .risk(channelId, wanted)
      .then((found) => {
        if (!isNewest()) return;
        setView(found);
        setProblem(null);
        // With nothing chosen yet, show the first script that has one.
        const first = found?.concepts[0]?.conceptId;
        if (wanted === null && first !== undefined) setPicked(first);
      })
      .catch((error: unknown) => {
        if (isNewest()) setProblem(messageOf(error, 'It could not be loaded'));
      });
  }, [api, requests, channelId, wanted, reloadKey, turn]);

  const conceptId = view?.check?.conceptId ?? wanted ?? view?.concepts[0]?.conceptId ?? null;
  const onScreen = useOnScreen();
  /** Follows a check, started here or before the owner went elsewhere, to its end. */
  const track = useCallback(
    (start: () => Promise<string>, checked: number) => {
      const stillHere = () => onScreen.current;
      setWork({ status: 'running', text: 'Starting' });
      start()
        .then((id) => follow(api, id, (text) => setWork({ status: 'running', text }), stillHere))
        .then((job) => {
          if (!stillHere()) return;
          setWork(
            job.status === 'done' && job.result?.kind === 'risk-check'
              ? {
                  status: 'done',
                  text: `Kept ${job.result.outcome.claims} claims and ${job.result.outcome.notes} notes; ${job.result.outcome.dropped} dropped for quotes that were not really there.`,
                }
              : { status: 'failed', text: job.error ?? 'It did not finish' },
          );
        })
        .catch((error: unknown) =>
          setWork({ status: 'failed', text: messageOf(error, 'It could not start') }),
        )
        .finally(() => {
          setPicked(checked);
          setTurn((value) => value + 1);
        });
    },
    [api, onScreen],
  );

  const ask = useCallback(() => {
    if (channelId === null || conceptId === null) return;
    track(() => api.askRisk(channelId, conceptId), conceptId);
  }, [api, channelId, conceptId, track]);

  useReattach(RISK_KINDS, channelId, (job) => {
    if (job.conceptId === null) return;
    setPicked(job.conceptId);
    track(() => Promise.resolve(job.id), job.conceptId);
  });

  return { view, conceptId, choose: setPicked, problem, work, ask };
}

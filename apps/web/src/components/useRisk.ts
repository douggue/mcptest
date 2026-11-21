import { useCallback, useEffect, useMemo, useState } from 'react';
import { createExtrasApi } from '../lib/extrasApi';
import { requestCounter } from '../lib/requests';
import type { RiskView } from '../lib/risk';
import { follow, type Work } from './useComments';

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
      })
      .catch((error: unknown) => {
        if (isNewest()) setProblem(messageOf(error, 'It could not be loaded'));
      });
  }, [api, requests, channelId, wanted, reloadKey, turn]);

  const conceptId = view?.check?.conceptId ?? wanted ?? view?.concepts[0]?.conceptId ?? null;
  const ask = useCallback(() => {
    if (channelId === null || conceptId === null) return;
    setWork({ status: 'running', text: 'Starting' });
    api
      .askRisk(channelId, conceptId)
      .then((id) => follow(api, id, (text) => setWork({ status: 'running', text })))
      .then((job) =>
        setWork(
          job.status === 'done' && job.result?.kind === 'risk-check'
            ? {
                status: 'done',
                text: `Kept ${job.result.outcome.claims} claims and ${job.result.outcome.notes} notes; ${job.result.outcome.dropped} dropped for quotes that were not really there.`,
              }
            : { status: 'failed', text: job.error ?? 'It did not finish' },
        ),
      )
      .catch((error: unknown) =>
        setWork({ status: 'failed', text: messageOf(error, 'It could not start') }),
      )
      .finally(() => {
        setPicked(conceptId);
        setTurn((value) => value + 1);
      });
  }, [api, channelId, conceptId]);

  return { view, conceptId, choose: setPicked, problem, work, ask };
}

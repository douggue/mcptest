import type { LogoFound, LogoProgress, MapSnapshot } from '@jgtube/core';
import { useEffect, useState } from 'react';
import {
  LOGO_POLL_MS,
  LOGO_RETRY_MS,
  afterLogoRun,
  afterLogoStart,
  needsLogos,
  type LogoApi,
  type LogoStep,
} from '../lib/logos';
import { followJob } from '../lib/requests';

/**
 * When a map is opened whose channels were read before logos were stored,
 * has the server fetch the missing ones and hands each batch to `onLogos` as
 * it arrives. Asks nothing of the owner, and gives up quietly: a missing logo
 * is shown as initials, as before.
 *
 * Returns how far the fetch has got while one is running, else null.
 */
export function useLogos(
  api: LogoApi,
  snapshot: MapSnapshot | null,
  onLogos: (mapId: number, logos: readonly LogoFound[]) => void,
): LogoProgress | 'starting' | null {
  const [progress, setProgress] = useState<LogoProgress | 'starting' | null>(null);
  const mapId = snapshot?.mapId ?? null;
  const centerId = snapshot?.center.id ?? null;
  // True until every channel has a logo, so logos arriving one by one do not restart the effect.
  const lacking = snapshot !== null && needsLogos(snapshot);

  useEffect(() => {
    if (mapId === null || centerId === null || !lacking) return;
    let over = false;
    let stopFollowing: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;

    const take = (step: LogoStep, round: number): void => {
      if (over) return;
      if (step.kind === 'follow') follow(step.jobId, round);
      else if (step.kind === 'again') ask(round + 1);
      else if (step.kind === 'later') timer = setTimeout(() => ask(round + 1), LOGO_RETRY_MS);
      else setProgress(null);
    };
    const ask = (round: number): void => {
      api.start(centerId).then(
        (start) => take(afterLogoStart(start, round), round),
        () => take({ kind: 'stop' }, round),
      );
    };
    const follow = (jobId: string, round: number): void => {
      setProgress('starting');
      stopFollowing = followJob({
        intervalMs: LOGO_POLL_MS,
        read: () => api.job(jobId),
        onReading: (job) => {
          if (job.progress) {
            setProgress(job.progress);
            onLogos(mapId, job.progress.logos);
          }
          if (job.status === 'running') return false;
          setProgress(null);
          take(afterLogoRun(job.result, round), round);
          return true;
        },
        onLost: () => take({ kind: 'stop' }, round),
      });
    };
    ask(1);

    return () => {
      over = true;
      stopFollowing();
      clearTimeout(timer);
      setProgress(null);
    };
  }, [api, mapId, centerId, lacking, onLogos]);

  return progress;
}

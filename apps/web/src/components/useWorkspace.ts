import type { MapSnapshot, NicheChannel, SavedChannel } from '@jgtube/core';
import { useCallback, useMemo } from 'react';
import type { Api } from '../lib/api';
import { breakdownChoices } from '../lib/breakdown';
import { createLabApi } from '../lib/labApi';
import { voiceChoices } from '../lib/scriptWriter';
import { useAlertCounts } from './useAlerts';
import { useAnalysis } from './useAnalysis';
import { useBreakdown } from './useBreakdown';
import { useLab } from './useLab';
import { useLabJob } from './useLabJob';
import { useNiches } from './useNiches';
import { useRefresh } from './useRefresh';
import { useSameTopic } from './useSameTopic';
import { useResearch } from './useResearch';
import { useScript } from './useScript';
import { useThumbnailBoard } from './useThumbnailBoard';
import { useTransfers } from './useTransfers';

/** The niche list before it has loaded: one empty list, so nothing is recomputed for it. */
const NO_NICHES: readonly NicheChannel[] = [];

/**
 * What every section below the radar reads and does, for the map on screen:
 * the research lists, the AI runs, the idea lab, the script writer and the refresh.
 */
export function useWorkspace(
  api: Api,
  snapshot: MapSnapshot | null,
  saved: readonly SavedChannel[],
) {
  const labApi = useMemo(() => createLabApi(), []);
  const centerId = snapshot?.center.id ?? null;
  const mapId = snapshot?.mapId ?? null;
  const board = useThumbnailBoard(api, snapshot);
  const sameTopic = useSameTopic(api, snapshot);
  const niches = useNiches(api, mapId);
  const transfers = useTransfers(api, centerId, mapId);
  const analysis = useAnalysis(api);
  const breakdown = useBreakdown(api);
  const nicheChannels = niches.state.status === 'ready' ? niches.state.list.channels : NO_NICHES;
  const breakdownChannels = useMemo(
    () => (snapshot ? breakdownChoices(snapshot, { saved, niches: nicheChannels }) : []),
    [snapshot, saved, nicheChannels],
  );
  const labJobs = useLabJob(labApi);
  const lab = useLab(labApi, labJobs, centerId, mapId, analysis.choice);
  // One AI run at a time, here as on the server: an analysis, a breakdown or one of the lab's.
  const asking =
    analysis.state.status === 'running' ||
    breakdown.state.status === 'running' ||
    labJobs.state.status === 'running';
  const script = useScript(labApi, labJobs, centerId, analysis.choice);
  const research = useResearch(
    labApi,
    labJobs,
    centerId,
    script.view?.concept.id ?? null,
    analysis.choice,
  );
  const voices = useMemo(() => (snapshot ? voiceChoices(snapshot) : []), [snapshot]);
  const reloadNiches = niches.reload;
  const reloadTransfers = transfers.reload;
  // A refresh stores new view counts and videos: the niche list turns them into
  // measured growth, and the transfer list may find new versions of an idea.
  const afterRefresh = useCallback(() => {
    reloadNiches();
    reloadTransfers();
  }, [reloadNiches, reloadTransfers]);
  const refresh = useRefresh(api, afterRefresh);
  const alertCounts = useAlertCounts(refresh.run.status);
  return {
    ...{ board, sameTopic, niches, transfers, analysis, breakdown, breakdownChannels },
    ...{ labJobs, lab, asking, script, research, voices, refresh, alertCounts },
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;

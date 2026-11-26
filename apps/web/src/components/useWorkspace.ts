import type { MapSnapshot, NicheChannel, SavedChannel } from '@jgtube/core';
import { useCallback, useMemo } from 'react';
import type { Api } from '../lib/api';
import type { DataPart } from '../lib/dataParts';
import { breakdownChoices } from '../lib/breakdown';
import { createLabApi } from '../lib/labApi';
import { voiceChoices } from '../lib/scriptWriter';
import { useAlertCounts } from './useAlerts';
import { useAnalysis } from './useAnalysis';
import { useBreakdown } from './useBreakdown';
import { useVideoBreakdown } from './useVideoBreakdown';
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

/** What the screens opened so far show, and whether the map on screen is known yet. */
export interface Wanted {
  readonly parts: ReadonlySet<DataPart>;
  /** The first map has been looked for (found or not), so a read for "no channel" is final. */
  readonly mapKnown: boolean;
}

/** Everything wanted at once, as before screens said what they show. */
const EVERYTHING: Wanted = {
  parts: new Set<DataPart>([
    'board',
    'sameTopic',
    'niches',
    'transfers',
    'concepts',
    'hooks',
    'formulas',
  ]),
  mapKnown: true,
};

/**
 * What every section below the radar reads and does, for the map on screen:
 * the research lists, the AI runs, the idea lab, the script writer and the
 * refresh. Each slow read waits until a screen that shows it is opened.
 */
export function useWorkspace(
  api: Api,
  snapshot: MapSnapshot | null,
  saved: readonly SavedChannel[],
  wanted: Wanted = EVERYTHING,
) {
  const wants = (part: DataPart): boolean => wanted.parts.has(part);
  const labApi = useMemo(() => createLabApi(), []);
  const centerId = snapshot?.center.id ?? null;
  const mapId = snapshot?.mapId ?? null;
  const board = useThumbnailBoard(api, snapshot, wants('board'));
  const sameTopic = useSameTopic(api, snapshot, wants('sameTopic'));
  const niches = useNiches(api, mapId, wants('niches'));
  const transfers = useTransfers(api, centerId, mapId, wants('transfers') && wanted.mapKnown);
  const analysis = useAnalysis(api);
  const breakdown = useBreakdown(api);
  const videoBreakdown = useVideoBreakdown();
  const nicheChannels = niches.state.status === 'ready' ? niches.state.list.channels : NO_NICHES;
  const breakdownChannels = useMemo(
    () => (snapshot ? breakdownChoices(snapshot, { saved, niches: nicheChannels }) : []),
    [snapshot, saved, nicheChannels],
  );
  const labJobs = useLabJob(labApi);
  const [concepts, hooks, formulas] = [wants('concepts'), wants('hooks'), wants('formulas')];
  const labWanted = useMemo(() => ({ concepts, hooks, formulas }), [concepts, hooks, formulas]);
  const lab = useLab(labApi, labJobs, centerId, mapId, analysis.choice, labWanted);
  // One AI run at a time, here as on the server: an analysis, a breakdown or one of the lab's.
  const asking =
    analysis.state.status === 'running' ||
    breakdown.state.status === 'running' ||
    videoBreakdown.run.status === 'running' ||
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
    ...{
      board,
      sameTopic,
      niches,
      transfers,
      analysis,
      breakdown,
      breakdownChannels,
      videoBreakdown,
    },
    ...{ labJobs, lab, asking, script, research, voices, refresh, alertCounts },
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;

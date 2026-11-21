/**
 * The owner's own videos against the plan for one centre channel. Linking
 * reads YouTube at most once, for the centre channel itself, and only when the
 * pasted video is not stored; everything shown is read from the store.
 */
import { linkVideo, loadPlan, parseVideoRef, type MapRepo, type PlanDeps } from '@jgtube/core';
import type { PlanEngine } from './planTypes';

export interface PlanEngineDeps {
  readonly now: () => Date;
  readonly repos: PlanDeps & { readonly maps: Pick<MapRepo, 'latestForCenter'> };
  /** Reads one channel's videos from YouTube into the store. */
  readonly readChannel: (channelId: string) => Promise<void>;
}

const videoIdOf = (link: string): string | null => {
  try {
    return parseVideoRef(link);
  } catch {
    return null;
  }
};

export function planEngine({ now, repos, readChannel }: PlanEngineDeps): PlanEngine {
  const hasMap = (center: string): boolean => repos.maps.latestForCenter(center) !== null;

  return {
    findPlan(center) {
      return hasMap(center) ? loadPlan(repos, center, now()) : null;
    },

    async linkPlanVideo(center, conceptId, link) {
      if (!hasMap(center)) return { outcome: 'no-map', plan: null };
      const videoId = videoIdOf(link);
      if (videoId === null) return { outcome: 'bad-link', plan: null };
      let { status } = linkVideo(repos, center, conceptId, videoId, now());
      if (status === 'not-stored') {
        await readChannel(center);
        ({ status } = linkVideo(repos, center, conceptId, videoId, now()));
        if (status === 'not-stored') return { outcome: 'not-found', plan: null };
      }
      return { outcome: status, plan: status === 'linked' ? loadPlan(repos, center, now()) : null };
    },

    unlinkPlanVideo(center, conceptId) {
      if (!hasMap(center)) return null;
      repos.links.unlink(center, conceptId);
      return loadPlan(repos, center, now());
    },
  };
}

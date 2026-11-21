/**
 * "What changed since you last looked" for one centre channel: read from the
 * store by core, with the moment the owner last marked the channel as seen.
 */
import { loadChanges, resolveSince, type ChangesDeps } from '@jgtube/core';
import type { ChangesEngine } from './extrasTypes';

export interface ChangesEngineDeps {
  readonly now: () => Date;
  readonly repos: ChangesDeps;
}

export function changesEngine({ now, repos }: ChangesEngineDeps): ChangesEngine {
  return {
    findChanges(centerChannelId, asked) {
      const lastLook = repos.looks.lastLook(centerChannelId);
      const at = now();
      const { since, kind } = resolveSince(asked, lastLook, at);
      const view = loadChanges(repos, centerChannelId, since, at);
      return (
        view && { ...view, asked, sinceKind: kind, lastLookAt: lastLook?.toISOString() ?? null }
      );
    },

    markChangesSeen(centerChannelId) {
      if (repos.maps.latestForCenter(centerChannelId) === null) return null;
      const at = now();
      repos.looks.markSeen(centerChannelId, at);
      return at.toISOString();
    },
  };
}

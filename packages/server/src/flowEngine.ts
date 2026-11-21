/**
 * How far the owner has come along the path from research to a finished
 * script, for the channel on screen: how many of each thing are stored for
 * it. Counted in code from the store; nothing is estimated.
 */
import {
  FORMULA_DEFAULT_WINDOW_DAYS,
  mapChannelIds,
  type BreakdownRepo,
  type ChannelNoteRepo,
  type ConceptRepo,
  type FormulaRepo,
  type MapVideoDeps,
  type ScriptRepo,
} from '@jgtube/core';
import type { Engine } from './app';

export interface FlowCounts {
  /** Breakout videos on the latest map. */
  readonly breakouts: number;
  /** Title formulas stored for the default window. */
  readonly formulas: number;
  /** Openings in the hook library. */
  readonly hooks: number;
  readonly concepts: number;
  /** Concepts with a script started. */
  readonly scripts: number;
  /** Channels of the map, the owner's own included, with a stored breakdown. */
  readonly breakdowns: number;
  readonly thumbnailReview: boolean;
  readonly styleLock: boolean;
}

export interface FlowEngine {
  /** Null when the channel has no map. Reads the store only. */
  flowCounts(centerChannelId: string): FlowCounts | null;
}

export interface FlowDeps {
  readonly repos: Pick<MapVideoDeps, 'maps'> & {
    readonly formulas: Pick<FormulaRepo, 'list'>;
    readonly concepts: Pick<ConceptRepo, 'listForCenter'>;
    readonly scripts: Pick<ScriptRepo, 'list'>;
    readonly breakdowns: Pick<BreakdownRepo, 'list'>;
    readonly notes: Pick<ChannelNoteRepo, 'find'>;
  };
  readonly findSnapshot: Engine['findSnapshot'];
  /** How many openings of the hook library have their words read; zero when it is not built. */
  readonly hookCount: (centerChannelId: string) => number;
}

export function flowEngine(deps: FlowDeps): FlowEngine {
  const { repos } = deps;
  return {
    flowCounts(centerChannelId) {
      const onMap = mapChannelIds(repos.maps, centerChannelId);
      if (onMap === null) return null;
      const broken = [...onMap].filter((id) =>
        repos.breakdowns.list(id).some((part) => part.written),
      );
      return {
        breakouts: deps.findSnapshot(centerChannelId)?.breakouts.length ?? 0,
        formulas: repos.formulas.list(centerChannelId, FORMULA_DEFAULT_WINDOW_DAYS).length,
        hooks: deps.hookCount(centerChannelId),
        concepts: repos.concepts.listForCenter(centerChannelId).length,
        scripts: repos.scripts.list(centerChannelId).length,
        breakdowns: broken.length,
        thumbnailReview: repos.notes.find(centerChannelId, 'thumbnail-review') !== null,
        styleLock: repos.notes.find(centerChannelId, 'style-lock') !== null,
      };
    },
  };
}

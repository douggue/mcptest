/**
 * How a listed niche channel was found, read from what the sweeps recorded:
 * a watchlist keyword, the snowball from another new niche, or one of the
 * owner's maps. A sweep's record wins, since it is only kept for a channel
 * the store did not hold before that sweep.
 */
import type { NicheFound, NicheFoundBy } from '../niches/types';
import type { StoredSweep, SweepFind, SweepRepo } from './types';

/** How many sweeps back the latest finished one is looked for. */
const SWEEPS_LOOKED_AT = 10;

export interface FoundDeps {
  readonly sweeps: SweepRepo;
  /** A stored channel's title; null when the store does not hold it. */
  readonly titleOf: (channelId: string) => string | null;
  /** Every channel some map holds. */
  readonly onAMap: () => readonly string[];
}

/** The latest sweep that ran to an end, whichever way it ended. */
export function latestFinished(sweeps: SweepRepo): StoredSweep | null {
  return sweeps.list(SWEEPS_LOOKED_AT).find((sweep) => sweep.finishedAt !== null) ?? null;
}

function fromFind(find: SweepFind, titleOf: FoundDeps['titleOf']): NicheFoundBy | null {
  if (find.source === 'keyword') {
    return find.keyword === null ? null : { kind: 'keyword', keyword: find.keyword };
  }
  return find.fromChannelId === null
    ? null
    : {
        kind: 'snowball',
        fromChannelId: find.fromChannelId,
        fromTitle: titleOf(find.fromChannelId),
      };
}

/** A reader for one niche list: the finds and the maps' members are read once. */
export function foundReader(deps: FoundDeps): {
  readonly foundOf: (channelId: string) => NicheFound;
  readonly lastSweepAt: Date | null;
} {
  const finds = deps.sweeps.finds();
  const onAMap = new Set(deps.onAMap());
  const last = latestFinished(deps.sweeps);
  return {
    lastSweepAt: last?.finishedAt ?? null,
    foundOf(channelId) {
      const find = finds.get(channelId);
      const bySweep = find ? fromFind(find, deps.titleOf) : null;
      return {
        foundBy: bySweep ?? (onAMap.has(channelId) ? { kind: 'map' } : null),
        newSinceSweep: find !== undefined && last !== null && find.sweepId === last.id,
      };
    },
  };
}

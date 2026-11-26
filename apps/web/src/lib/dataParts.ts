/**
 * Which of the slow reads each screen shows. The workspace reads a part only
 * once a screen that shows it has been opened (or the Ask panel, for the
 * answers kept), so opening the page asks for what is on it and nothing
 * else. A part once read stays read: going back to its screen shows it at
 * once, and it is read again on the same events as before (a new map, a
 * refresh, a job that changed it).
 */
import type { Route, ViewId } from './routes';

export type DataPart =
  /** The thumbnail board of the map on screen. */
  | 'board'
  | 'sameTopic'
  | 'niches'
  | 'transfers'
  /** The idea lab's concepts and their thumbnail prompts. */
  | 'concepts'
  /** The hook library. */
  | 'hooks'
  /** The title formulas. */
  | 'formulas'
  /** The counts of the path from research to a script, on Today. */
  | 'flow'
  /** The answers kept for the channel: the quick questions and the owner's own. */
  | 'answers';

const BY_VIEW: Partial<Record<ViewId, readonly DataPart[]>> = {
  home: ['flow'],
  thumbnails: ['board'],
  'same-topic': ['sameTopic'],
  niches: ['niches'],
  // The Breakdown view offers the map's channels and the niche list's.
  breakdown: ['niches'],
  'own-breakdown': ['niches'],
  transfers: ['transfers'],
  ideas: ['concepts', 'hooks', 'formulas', 'transfers'],
  script: ['concepts', 'hooks'],
  formats: ['formulas'],
  hooks: ['hooks'],
  ask: ['answers'],
};

const NONE: readonly DataPart[] = [];

/** The parts the screen shows; `asking` is the Ask panel open beside it. */
export function partsFor(route: Route, asking: boolean): readonly DataPart[] {
  const own = BY_VIEW[route.view] ?? NONE;
  const tab =
    route.view === 'channel' && route.tab === 'thumbnails'
      ? (['board'] as const)
      : route.view === 'channel' && route.tab === 'breakdown'
        ? (['niches'] as const)
        : route.view === 'video' && route.tab === 'hook'
          ? (['hooks'] as const)
          : NONE;
  return [...own, ...tab, ...(asking ? (['answers'] as const) : NONE)];
}

/** The parts wanted so far with `parts` added; the same set when nothing is new. */
export function withParts(
  wanted: ReadonlySet<DataPart>,
  parts: readonly DataPart[],
): ReadonlySet<DataPart> {
  return parts.every((part) => wanted.has(part)) ? wanted : new Set([...wanted, ...parts]);
}

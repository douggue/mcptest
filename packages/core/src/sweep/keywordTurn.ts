/**
 * One keyword's turn in a sweep: a search, then the channels behind the
 * videos it found, most found first, through the usual ingest. A channel the
 * store read in the last week is left alone; the refresh keeps those current.
 */
import { ingestChannel, type IngestDeps } from '../ingest';
import type { FoundVideo } from '../sources/searchResults';
import {
  addPots,
  SWEEP_CHANNELS_PER_KEYWORD,
  SWEEP_REREAD_DAYS,
  sweepCosts,
  type Pots,
} from './budget';
import type { ReadCost, Stop, SweepReader } from './reader';
import type { WatchKeyword } from './types';
import type { FindVia } from '../bank/cost';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReadingDeps extends IngestDeps {
  readonly via: FindVia;
  readonly search: (query: string) => Promise<readonly FoundVideo[]>;
  /** The requests made to the API so far, counted exactly; absent when reading pages. */
  readonly apiRequestsMade?: () => number;
}

/** A channel a sweep read, and whether the store held it before. */
export interface ChannelRead {
  readonly channelId: string;
  readonly wasNew: boolean;
}

export interface KeywordTurn {
  readonly entry: WatchKeyword;
  readonly searched: boolean;
  readonly channelsFound: number;
  readonly read: readonly ChannelRead[];
  readonly alreadyKnown: number;
  readonly failed: number;
  readonly stop: Stop | null;
}

/** Channel ids behind the videos: most videos found first, then in the order found. */
export function rankChannels(found: readonly FoundVideo[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const video of found) counts.set(video.channelId, (counts.get(video.channelId) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([channelId]) => channelId);
}

/** What reading one channel is charged, counted exactly afterwards when the API does the reading. */
export function channelPrice(deps: ReadingDeps, reserve: Pots): ReadCost {
  const { channel } = sweepCosts(deps.via);
  const made = deps.apiRequestsMade;
  if (deps.via !== 'api' || made === undefined) return { cost: channel, reserve };
  const before = made();
  return { cost: channel, reserve, counted: () => ({ pages: 0, units: made() - before }) };
}

const readLately = (deps: ReadingDeps, channelId: string): boolean => {
  const known = deps.channels.findById(channelId);
  return (
    known !== null && deps.now().getTime() - known.fetchedAt.getTime() < SWEEP_REREAD_DAYS * DAY_MS
  );
};

type Tally = Pick<KeywordTurn, 'read' | 'alreadyKnown' | 'failed' | 'stop'>;

async function readFound(
  deps: ReadingDeps,
  reader: SweepReader,
  channelIds: readonly string[],
  reserve: Pots,
): Promise<Tally> {
  let tally: Tally = { read: [], alreadyKnown: 0, failed: 0, stop: null };
  for (const channelId of channelIds) {
    if (readLately(deps, channelId)) {
      tally = { ...tally, alreadyKnown: tally.alreadyKnown + 1 };
      continue;
    }
    const wasNew = deps.channels.findById(channelId) === null;
    const result = await reader.attempt(channelPrice(deps, reserve), () =>
      ingestChannel(deps, channelId),
    );
    if (result.kind === 'stop') return { ...tally, stop: result.stop };
    tally =
      result.kind === 'ok'
        ? { ...tally, read: [...tally.read, { channelId, wasNew }] }
        : { ...tally, failed: tally.failed + 1 };
  }
  return tally;
}

/** Searches for one keyword and reads what it found, leaving `reserve` of the budget untouched. */
export async function sweepKeyword(
  deps: ReadingDeps,
  reader: SweepReader,
  entry: WatchKeyword,
  reserve: Pots,
): Promise<KeywordTurn> {
  const costs = sweepCosts(deps.via);
  const none = { entry, searched: false, channelsFound: 0, read: [], alreadyKnown: 0, failed: 0 };
  const search = await reader.attempt(
    // A search is only worth making when at least one channel can be read after it.
    { cost: costs.search, needs: addPots(costs.search, costs.channel), reserve },
    () => deps.search(entry.keyword),
  );
  if (search.kind === 'stop') return { ...none, stop: search.stop };
  if (search.kind === 'failed') return { ...none, failed: 1, stop: null };
  const ranked = rankChannels(search.value);
  const tally = await readFound(
    deps,
    reader,
    ranked.slice(0, SWEEP_CHANNELS_PER_KEYWORD),
    reserve,
  );
  return { entry, searched: true, channelsFound: ranked.length, ...tally };
}

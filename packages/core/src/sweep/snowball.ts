/**
 * The snowball: from each channel a sweep newly found to be a niche, the
 * sidebars of its two top took-off videos are read (the same sidebar read a
 * map makes), and the channels standing there that the store has never held
 * are read, the most seen first. One hop only: what the snowball finds is
 * never snowballed from. Whether a sibling is small is known only once it is
 * read; the niche rule then judges it like any other channel.
 */
import { ingestChannel } from '../ingest';
import {
  addPots,
  NO_SPEND,
  SNOWBALL_MAX_SOURCES,
  SNOWBALL_SIBLINGS_PER_SOURCE,
  SNOWBALL_VIDEOS_PER_SOURCE,
  sweepCosts,
} from './budget';
import { channelPrice, type ReadingDeps } from './keywordTurn';
import type { Stop, SweepReader } from './reader';

/** A channel that qualifies as a niche now, with its took-off videos, strongest first. */
export interface NicheNow {
  readonly id: string;
  readonly videoIds: readonly string[];
}

/** A sibling the snowball read, and the new niche it stood beside. */
export interface SnowballRead {
  readonly channelId: string;
  readonly fromChannelId: string;
}

export interface SnowballTurn {
  readonly sources: number;
  readonly sidebarsRead: number;
  readonly read: readonly SnowballRead[];
  readonly failed: number;
  readonly stop: Stop | null;
}

const NOTHING: SnowballTurn = { sources: 0, sidebarsRead: 0, read: [], failed: 0, stop: null };

interface Beside {
  readonly counts: ReadonlyMap<string, number>;
  readonly sidebarsRead: number;
  readonly failed: number;
  readonly stop: Stop | null;
}

/** The unknown channels beside a source's top videos, with how often each stood there. */
async function besideOf(
  deps: ReadingDeps,
  reader: SweepReader,
  source: NicheNow,
): Promise<Beside> {
  const costs = sweepCosts(deps.via);
  const counts = new Map<string, number>();
  let done = { sidebarsRead: 0, failed: 0 };
  for (const videoId of source.videoIds.slice(0, SNOWBALL_VIDEOS_PER_SOURCE)) {
    const result = await reader.attempt(
      // A sidebar is only worth reading when a sibling can be read after it.
      { cost: costs.sidebar, needs: addPots(costs.sidebar, costs.channel) },
      () => deps.source.getSidebar(videoId),
    );
    if (result.kind === 'stop') return { counts, ...done, stop: result.stop };
    if (result.kind === 'failed') {
      done = { ...done, failed: done.failed + 1 };
      continue;
    }
    done = { ...done, sidebarsRead: done.sidebarsRead + 1 };
    for (const { channelId } of result.value) {
      if (channelId === null || channelId === source.id) continue;
      if (deps.channels.findById(channelId) !== null) continue;
      counts.set(channelId, (counts.get(channelId) ?? 0) + 1);
    }
  }
  return { counts, ...done, stop: null };
}

const mostSeen = (counts: ReadonlyMap<string, number>): readonly string[] =>
  [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, SNOWBALL_SIBLINGS_PER_SOURCE)
    .map(([channelId]) => channelId);

async function fromSource(
  deps: ReadingDeps,
  reader: SweepReader,
  source: NicheNow,
  so: SnowballTurn,
): Promise<SnowballTurn> {
  const beside = await besideOf(deps, reader, source);
  let turn: SnowballTurn = {
    ...so,
    sources: so.sources + 1,
    sidebarsRead: so.sidebarsRead + beside.sidebarsRead,
    failed: so.failed + beside.failed,
    stop: beside.stop,
  };
  if (turn.stop) return turn;
  for (const channelId of mostSeen(beside.counts)) {
    const result = await reader.attempt(channelPrice(deps, NO_SPEND), () =>
      ingestChannel(deps, channelId),
    );
    if (result.kind === 'stop') return { ...turn, stop: result.stop };
    turn =
      result.kind === 'ok'
        ? { ...turn, read: [...turn.read, { channelId, fromChannelId: source.id }] }
        : { ...turn, failed: turn.failed + 1 };
  }
  return turn;
}

/** Reads the siblings of the new niches, a capped number of sources and siblings. */
export async function snowball(
  deps: ReadingDeps,
  reader: SweepReader,
  sources: readonly NicheNow[],
  onSource: (index: number, total: number) => void,
): Promise<SnowballTurn> {
  const chosen = sources.slice(0, SNOWBALL_MAX_SOURCES);
  let turn = NOTHING;
  for (const [index, source] of chosen.entries()) {
    onSource(index, chosen.length);
    turn = await fromSource(deps, reader, source, turn);
    if (turn.stop) return turn;
  }
  return turn;
}

/**
 * Reads stored channels again so that history builds up.
 *
 * A channel is otherwise only read when a crawl or a search touches it. Every
 * read stores each video's view count, so a channel read again a day later
 * shows what it really gained. This goes through the store, picks the channels
 * read longest ago and reads each one again, a bounded number per run.
 */
import { ingestChannel, type IngestDeps } from '../ingest';
import { loadMapSnapshot } from '../map/snapshot';
import { loadNicheList } from '../niches/niches';
import type {
  EdgeRepo,
  MapRepo,
  RefreshRunRepo,
  StoredChannel,
  WatchlistRepo,
} from '../repos/types';

/**
 * Channels read per run. Each costs a few page requests, taken one channel at
 * a time, so fifty is a few minutes of gentle traffic. Four runs a day cover a
 * store of 200 channels daily.
 */
export const DEFAULT_REFRESH_MAX_CHANNELS = 50;
export const MAX_REFRESH_CHANNELS = 500;
/**
 * A channel read more recently than this is left alone. Growth is read off
 * daily readings; reading a channel more often than about once a day adds
 * requests and no information. Twenty hours, not twenty-four, so that a daily
 * run that starts a little early still finds yesterday's channels due.
 */
export const REFRESH_MIN_AGE_HOURS = 20;
/**
 * This many failures in a row means YouTube is refusing us, not that one
 * channel is odd, so the run stops. The crawl allows eight across four
 * requests at a time; this reads one channel at a time, so five is as clear.
 */
export const REFRESH_MAX_CONSECUTIVE_FAILURES = 5;
const HOUR_MS = 60 * 60 * 1000;

export interface RefreshDeps extends IngestDeps {
  readonly edges: EdgeRepo;
  readonly maps: MapRepo;
  readonly watchlist: WatchlistRepo;
  readonly runs: RefreshRunRepo;
}

export interface RefreshProgress {
  readonly stage: 'refreshing';
  /** Channels tried so far, read or not. */
  readonly done: number;
  /** Channels this run set out to read. */
  readonly total: number;
}

export interface RefreshOptions {
  /** The most channels to read in this run. */
  readonly maxChannels?: number;
  readonly onProgress?: (progress: RefreshProgress) => void;
}

export interface RefreshFailure {
  readonly channelId: string;
  readonly error: string;
}

export interface RefreshResult {
  /** Channels this run set out to read. */
  readonly picked: number;
  readonly refreshed: readonly string[];
  readonly failed: readonly RefreshFailure[];
  /** Picked channels left unread because the run stopped early. */
  readonly notAttempted: number;
  /** YouTube refused several channels in a row, so the run gave up. */
  readonly stoppedEarly: boolean;
  /** Channels still due for a read when the run ended; a later run takes them. */
  readonly stillDue: number;
}

export interface PickInput {
  readonly channels: readonly StoredChannel[];
  /** Channels read before the rest when both are due. */
  readonly priorityIds: ReadonlySet<string>;
  readonly now: Date;
  readonly maxChannels: number;
}

const isDue = (channel: StoredChannel, now: Date): boolean =>
  now.getTime() - channel.fetchedAt.getTime() >= REFRESH_MIN_AGE_HOURS * HOUR_MS;

/**
 * The channels a run reads, in order: only those due, the ones that matter to
 * the owner first, and within each group the one read longest ago first.
 *
 * Because a channel just read is no longer due, the priority group cannot
 * starve the rest: once it has been read today, the run moves on to the others.
 */
export function pickStalest(input: PickInput): readonly StoredChannel[] {
  const rank = (channel: StoredChannel): number => (input.priorityIds.has(channel.id) ? 0 : 1);
  return input.channels
    .filter((channel) => isDue(channel, input.now))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.fetchedAt.getTime() - b.fetchedAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .slice(0, input.maxChannels);
}

/**
 * The channels whose history the owner will look at: the ones they watch, the
 * ones on the niche list, and for each map its centre and the channels counted
 * as like it (the filter's own and the ones the owner kept, less any removed).
 */
export function refreshPriorityIds(deps: RefreshDeps, now: Date): ReadonlySet<string> {
  const onMaps = deps.maps.listCenterIds().flatMap((centerId) => {
    const snapshot = loadMapSnapshot(deps, centerId, now);
    const peers = (snapshot?.channels ?? []).filter((channel) => channel.peer && !channel.removed);
    return [centerId, ...peers.map((channel) => channel.id)];
  });
  return new Set([
    ...deps.watchlist.listWatched(),
    ...loadNicheList(deps, now).channels.map((channel) => channel.id),
    ...onMaps,
  ]);
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function assertMaxChannels(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_REFRESH_CHANNELS) {
    throw new RangeError(`maxChannels must be a whole number from 1 to ${MAX_REFRESH_CHANNELS}`);
  }
}

interface Tally {
  readonly refreshed: readonly string[];
  readonly failed: readonly RefreshFailure[];
  /** Failures since the last channel that could be read. */
  readonly streak: number;
}

/** Reads the picked channels one at a time until done or refused too often in a row. */
async function readAll(
  deps: RefreshDeps,
  picked: readonly StoredChannel[],
  onProgress: (progress: RefreshProgress) => void,
): Promise<Tally> {
  let tally: Tally = { refreshed: [], failed: [], streak: 0 };
  onProgress({ stage: 'refreshing', done: 0, total: picked.length });
  for (const channel of picked) {
    if (tally.streak >= REFRESH_MAX_CONSECUTIVE_FAILURES) break;
    try {
      await ingestChannel(deps, channel.id, { refresh: true });
      tally = { ...tally, refreshed: [...tally.refreshed, channel.id], streak: 0 };
    } catch (error) {
      const failure = { channelId: channel.id, error: messageOf(error) };
      tally = { ...tally, failed: [...tally.failed, failure], streak: tally.streak + 1 };
    }
    onProgress({
      stage: 'refreshing',
      done: tally.refreshed.length + tally.failed.length,
      total: picked.length,
    });
  }
  return tally;
}

/**
 * Reads the stalest stored channels again, up to `maxChannels`, and records
 * the run. A channel that cannot be read is reported and skipped; several in a
 * row end the run early, leaving the rest for a later one.
 */
export async function refreshStalest(
  deps: RefreshDeps,
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const maxChannels = options.maxChannels ?? DEFAULT_REFRESH_MAX_CHANNELS;
  assertMaxChannels(maxChannels);
  const startedAt = deps.now();
  const picked = pickStalest({
    channels: deps.channels.listAll(),
    priorityIds: refreshPriorityIds(deps, startedAt),
    now: startedAt,
    maxChannels,
  });
  const tally = await readAll(deps, picked, options.onProgress ?? (() => {}));
  const notAttempted = picked.length - tally.refreshed.length - tally.failed.length;
  const finishedAt = deps.now();
  const stoppedEarly = notAttempted > 0;
  deps.runs.record({
    startedAt,
    finishedAt,
    refreshed: tally.refreshed.length,
    failed: tally.failed.length,
    stoppedEarly,
  });
  return {
    picked: picked.length,
    refreshed: tally.refreshed,
    failed: tally.failed,
    notAttempted,
    stoppedEarly,
    stillDue: deps.channels.listAll().filter((channel) => isDue(channel, finishedAt)).length,
  };
}

/** Plain values, ready to serialise. */
export interface RefreshStatus {
  /** The refresh that finished last, or null when there has been none. Times are ISO-8601. */
  readonly last: {
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly refreshed: number;
    readonly failed: number;
    readonly stoppedEarly: boolean;
  } | null;
  /** Channels in the store. */
  readonly channels: number;
  /** Of those, how many a refresh would read now. */
  readonly due: number;
  /** When the channel read longest ago was read; null on an empty store. */
  readonly oldestReadAt: string | null;
}

/** When the store was last refreshed and how much of it is due; reads the store only. */
export function loadRefreshStatus(
  deps: Pick<RefreshDeps, 'channels' | 'runs'>,
  now: Date,
): RefreshStatus {
  const channels = deps.channels.listAll();
  const last = deps.runs.latest();
  const oldest = Math.min(...channels.map((channel) => channel.fetchedAt.getTime()));
  return {
    last: last && {
      startedAt: last.startedAt.toISOString(),
      finishedAt: last.finishedAt.toISOString(),
      refreshed: last.refreshed,
      failed: last.failed,
      stoppedEarly: last.stoppedEarly,
    },
    channels: channels.length,
    due: channels.filter((channel) => isDue(channel, now)).length,
    oldestReadAt: channels.length > 0 ? new Date(oldest).toISOString() : null,
  };
}

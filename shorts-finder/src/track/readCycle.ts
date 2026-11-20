/**
 * One round of readings. Each tracked video whose time has come is read
 * again; its views, likes and comments are kept as a reading, its growth
 * figures are filled in, and its place in its group decides its next read.
 *
 * A round has a budget: what the reading share has left today, spread over
 * the hours left of the Pacific day, so readings never stop for hours late
 * in the day. The most promising videos are read first; what does not fit is
 * put off to the next round, never dropped, and counted in the report.
 */
import { abortReason, stopReasonFor, type StopReason } from '../cycleStop';
import { pacificHoursLeft, type QuotaLedger } from '../quota/ledger';
import type { ActiveVideo } from '../repos/types';
import type { YouTubeApi } from '../youtube/api';
import { buildCohorts, rankedAt, type Cohorts } from './promise';
import {
  NO_TALLY,
  planReadVideos,
  plusTally,
  provesNothing,
  storeBatch,
  type ReadStore,
  type ReadVideo,
} from './recordRead';
import { DUE_LOOK_AHEAD_MS, TOP_HALF_FROM } from './tiers';

export { MISSED_READS_BEFORE_GONE, MISS_MIN_GAP_MS, SUSPECT_EMPTY_BATCH_ABOVE } from './recordRead';

/** The API's limit on videos per request (1 unit). Each request is stored before the next is made. */
export const READ_BATCH_SIZE = 50;
/**
 * A round always makes at least one request when anything is due, however
 * little the share has left for the hour: a share that is truly spent refuses
 * the request itself, and the round then stops in the usual way.
 */
export const MIN_BATCHES_PER_ROUND = 1;

export interface ReadCycleDeps {
  readonly api: Pick<YouTubeApi, 'fetchVideos'>;
  readonly ledger: Pick<QuotaLedger, 'markExhausted' | 'remaining'>;
  readonly store: ReadStore;
  readonly now: () => Date;
}

export interface ReadCycleReport {
  /** Tracked videos whose read was due. */
  readonly due: number;
  /** Due videos put off to the next round because this one's budget was used: not dropped. */
  readonly deferred: number;
  /** Videos the API returned. */
  readonly read: number;
  /** Readings written: the videos read whose view count is visible. */
  readonly readings: number;
  /** Videos the API left out of its reply. */
  readonly missing: number;
  /** Videos whose tracking ended, for whatever reason. */
  readonly finished: number;
  /** Videos whose tracking ended as gone, after being missing on separate occasions. */
  readonly gone: number;
  /** Entries the API sent that could not be read. */
  readonly skipped: number;
  /** Requests answered with entries of which not one could be read. */
  readonly unreadablePages: number;
  /** Requests for many videos answered with none: not believed, and no miss counted. */
  readonly suspectReplies: number;
  /** Videos chosen for this round but not asked for, because it stopped first. */
  readonly leftUnread: number;
  readonly stopped: StopReason | null;
}

const NOTHING_READ: ReadCycleReport = {
  due: 0,
  deferred: 0,
  ...NO_TALLY,
  skipped: 0,
  unreadablePages: 0,
  suspectReplies: 0,
  leftUnread: 0,
  stopped: null,
};

const batchesOf = (due: readonly ActiveVideo[]): readonly (readonly ActiveVideo[])[] =>
  Array.from({ length: Math.ceil(due.length / READ_BATCH_SIZE) }, (_, index) =>
    due.slice(index * READ_BATCH_SIZE, (index + 1) * READ_BATCH_SIZE),
  );

/**
 * How many requests this round may make: the units the reading share has
 * left, divided by the hours left of the Pacific day (rounds are an hour
 * apart), and never fewer than one.
 */
export function batchBudget(readingUnitsLeft: number, now: Date): number {
  const roundsLeft = Math.max(1, Math.ceil(pacificHoursLeft(now)));
  return Math.max(MIN_BATCHES_PER_ROUND, Math.floor(readingUnitsLeft / roundsLeft));
}

/**
 * The due videos, most promising first: by place in their group, a video
 * with no known place counting as the middle; then the longest due.
 */
function mostPromisingFirst(
  due: readonly ActiveVideo[],
  cohorts: Cohorts,
  now: Date,
): readonly ActiveVideo[] {
  const place = new Map(
    due.map((video) => [
      video.videoId,
      cohorts.positionOf(rankedAt(video, now)).speedPercentile ?? TOP_HALF_FROM,
    ]),
  );
  const placeOf = (video: ActiveVideo): number => place.get(video.videoId) ?? TOP_HALF_FROM;
  const dueAt = (video: ActiveVideo): number => video.nextReadAt?.getTime() ?? 0;
  return due.toSorted(
    (a, b) => placeOf(b) - placeOf(a) || dueAt(a) - dueAt(b) || a.videoId.localeCompare(b.videoId),
  );
}

interface Round {
  readonly cycleStart: Date;
  readonly due: number;
  readonly chosen: readonly ActiveVideo[];
}

/** Decides what this round reads: what is due, in order of promise, as far as the budget goes. */
function planRound(deps: ReadCycleDeps): Round {
  // Next reads are counted from the round's start, so every video of a round
  // falls due together for the next one.
  const cycleStart = deps.now();
  const active = deps.store.tracking.listActive();
  const cohorts = buildCohorts(
    active.map((video) => rankedAt(video, cycleStart)),
    cycleStart,
  );
  const dueBefore = cycleStart.getTime() + DUE_LOOK_AHEAD_MS;
  const due = active.filter(
    (video) => video.nextReadAt !== null && video.nextReadAt.getTime() <= dueBefore,
  );
  const budget = batchBudget(deps.ledger.remaining(cycleStart).byKind.reading, cycleStart);
  const chosen = mostPromisingFirst(due, cohorts, cycleStart).slice(0, budget * READ_BATCH_SIZE);
  return { cycleStart, due: due.length, chosen };
}

/** Makes the round's requests, storing each one's readings before the next is made. */
async function readChosen(
  deps: ReadCycleDeps,
  round: Round,
  noteRead: (videos: readonly ReadVideo[]) => void,
  signal?: AbortSignal,
): Promise<ReadCycleReport> {
  const { cycleStart, due, chosen } = round;
  let report: ReadCycleReport = {
    ...NOTHING_READ,
    due,
    deferred: due - chosen.length,
    leftUnread: chosen.length,
  };
  for (const batch of batchesOf(chosen)) {
    const aborted = abortReason(signal);
    if (aborted !== null) return { ...report, stopped: aborted };
    const result = await deps.api.fetchVideos(batch.map((tracked) => tracked.videoId));
    if (result.error !== null) {
      const stopped = stopReasonFor(result.error, deps.ledger);
      if (stopped === null) throw result.error;
      return { ...report, stopped };
    }
    // Each reading carries the time of its own reply: a round of many
    // requests takes minutes, and a rate is only as good as its times.
    const stored = storeBatch(deps.store, batch, result, { cycleStart, repliedAt: deps.now() });
    noteRead(stored.read);
    const none = result.items.length === 0;
    const suspect = none && result.skipped === 0 && provesNothing(batch, result);
    report = {
      ...report,
      ...plusTally(report, stored.tally),
      skipped: report.skipped + result.skipped,
      unreadablePages: report.unreadablePages + (none && result.skipped > 0 ? 1 : 0),
      suspectReplies: report.suspectReplies + (suspect ? 1 : 0),
      leftUnread: report.leftUnread - batch.length,
    };
  }
  return report;
}

/**
 * Reads the tracked videos that are due, fifty per request, the most
 * promising first and as many as the round's budget allows, storing each
 * request's readings before making the next; then gives every video read its
 * place in its group and its next read. It stops cleanly, saying what was
 * left, when the allowance runs out, when Google asks for a pause, when the
 * lease is lost or when the service is stopping. Any other failed request is
 * thrown, after the requests before it have been stored and planned.
 */
export async function runReadCycle(
  deps: ReadCycleDeps,
  signal?: AbortSignal,
): Promise<ReadCycleReport> {
  const round = planRound(deps);
  let read: readonly ReadVideo[] = [];
  let finished = 0;
  try {
    const report = await readChosen(
      deps,
      round,
      (videos) => {
        read = [...read, ...videos];
      },
      signal,
    );
    finished = planReadVideos(deps.store, read, round.cycleStart);
    read = [];
    return { ...report, finished: report.finished + finished };
  } finally {
    // A round that failed part way has still read videos: they get their plan too.
    if (read.length > 0) planReadVideos(deps.store, read, round.cycleStart);
  }
}

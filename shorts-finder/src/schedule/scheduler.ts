/**
 * The loop that keeps the finder working all day: a round of readings every
 * hour, a round of searching whenever subjects are due, and the thinning of
 * old readings once a day.
 *
 * It is a plain function over what it is given: the cycles, a clock and a
 * timer. It starts no process and knows nothing of settings or alerts; the
 * program that will run it is a later step.
 */
import { reasonOf, type StopReason } from '../cycleStop';
import { ReadingElsewhereError, withYouTubeLease, type LeaseDeps } from '../lease';

const MS_PER_MINUTE = 60 * 1000;
/**
 * The loop looks at what is due every five minutes. Short enough that a
 * subject or a round of readings starts close to its time, and that work
 * refused because another program was reading is tried again soon; long
 * enough that an idle look costs nothing worth counting.
 */
export const SCHEDULER_TICK_MS = 5 * MS_PER_MINUTE;
/**
 * Readings are taken once an hour, the shortest tier, and in one round rather
 * than as each video falls due: fifty videos share one unit, so reading them
 * a few at a time would cost many times more.
 */
export const READ_CYCLE_EVERY_MS = 60 * MS_PER_MINUTE;
/**
 * After Google says requests are coming too fast, nothing is asked of it for
 * a quarter of an hour. Its limits are counted per minute, so this is many
 * times the wait it needs, and it still costs at most one late reading.
 */
export const RATE_LIMIT_PAUSE_MS = 15 * MS_PER_MINUTE;

export type CycleName = 'read' | 'channels' | 'search' | 'rollup';

/** What became of one piece of scheduled work. */
export interface CycleRecord {
  readonly cycle: CycleName;
  readonly startedAt: Date;
  /** `skipped`: other work held the lease, so this did not start and is tried again. */
  readonly result: 'done' | 'failed' | 'skipped';
  /** What the work reported, when it was done. */
  readonly report: unknown;
  /** Why it failed or was skipped. */
  readonly reason: string | null;
}

/** What the scheduler needs to know of a cycle's report: whether, and why, it stopped early. */
interface Stoppable {
  readonly stopped: StopReason | null;
}

type YouTubeWork = (signal: AbortSignal) => Promise<Stoppable>;

export interface SchedulerDeps {
  /** The lease every piece of work that reads YouTube runs under. */
  readonly lease: LeaseDeps;
  readonly now: () => Date;
  readonly readCycle: YouTubeWork;
  /** Reads channels still queued, after each round of readings. */
  readonly channelReads: YouTubeWork;
  readonly searchCycle: YouTubeWork;
  /** Whether any subject is due and can be paid for at `now`. */
  readonly searchIsDue: (now: Date) => boolean;
  /** Thins old readings; run once on each UTC day. */
  readonly dailyRollup: (now: Date) => unknown;
  /** Where every outcome goes: done, failed or skipped. */
  readonly record: (entry: CycleRecord) => void;
  /** Replace the timer; used by tests. */
  readonly every?: (run: () => void, ms: number) => unknown;
  readonly stop?: (handle: unknown) => void;
}

export interface Scheduler {
  /** Stops the loop. Work that is running finishes first; nothing new starts. */
  stop(): Promise<void>;
  /** Resolves when no work is running. */
  whenIdle(): Promise<void>;
}

const defaultEvery = (run: () => void, ms: number): unknown => setInterval(run, ms);

const defaultStop = (handle: unknown): void => {
  clearInterval(handle as ReturnType<typeof setInterval>);
};

const utcDay = (moment: Date): string => moment.toISOString().slice(0, 'YYYY-MM-DD'.length);

interface LoopState {
  lastReadAt: Date | null;
  lastRollupDay: string | null;
  pausedUntil: Date | null;
  stopping: boolean;
  running: Promise<void> | null;
}

/** Hands an outcome to the recorder; a recorder that fails must not stop the loop. */
function record(deps: SchedulerDeps, entry: CycleRecord): void {
  try {
    deps.record(entry);
  } catch {
    // The work itself is done or failed already; there is nowhere else to say so.
  }
}

/**
 * Runs one piece of work that reads YouTube, under the lease. Returns false
 * when it did not start because other work held the lease.
 */
async function runUnderLease(
  deps: SchedulerDeps,
  state: LoopState,
  cycle: CycleName,
  work: YouTubeWork,
): Promise<boolean> {
  const startedAt = deps.now();
  try {
    const report = await withYouTubeLease(deps.lease, work);
    if (report.stopped === 'rate_limit') {
      state.pausedUntil = new Date(deps.now().getTime() + RATE_LIMIT_PAUSE_MS);
    }
    record(deps, { cycle, startedAt, result: 'done', report, reason: null });
    return true;
  } catch (error) {
    const skipped = error instanceof ReadingElsewhereError;
    const result = skipped ? 'skipped' : 'failed';
    record(deps, { cycle, startedAt, result, report: null, reason: reasonOf(error) });
    return !skipped;
  }
}

/** Runs work that does not read YouTube, recording its outcome. */
function runLocal(deps: SchedulerDeps, cycle: CycleName, work: () => unknown): void {
  const startedAt = deps.now();
  try {
    record(deps, { cycle, startedAt, result: 'done', report: work(), reason: null });
  } catch (error) {
    record(deps, { cycle, startedAt, result: 'failed', report: null, reason: reasonOf(error) });
  }
}

/** Whether YouTube may be asked now: not while stopping, nor during a pause it asked for. */
const mayRead = (deps: SchedulerDeps, state: LoopState): boolean =>
  !state.stopping && (state.pausedUntil === null || deps.now() >= state.pausedUntil);

function searchIsDue(deps: SchedulerDeps): boolean {
  const startedAt = deps.now();
  try {
    return deps.searchIsDue(startedAt);
  } catch (error) {
    const reason = reasonOf(error);
    record(deps, { cycle: 'search', startedAt, result: 'failed', report: null, reason });
    return false;
  }
}

/** One look at what is due: readings, then searching, then the daily thinning. Never rejects. */
async function tick(deps: SchedulerDeps, state: LoopState): Promise<void> {
  const now = deps.now();
  const readDue =
    state.lastReadAt === null || now.getTime() - state.lastReadAt.getTime() >= READ_CYCLE_EVERY_MS;
  if (readDue && mayRead(deps, state)) {
    // A round that failed is not tried again until the next hour: a fault that
    // lasts would otherwise spend a unit per request every five minutes.
    if (await runUnderLease(deps, state, 'read', deps.readCycle)) state.lastReadAt = now;
    if (mayRead(deps, state)) await runUnderLease(deps, state, 'channels', deps.channelReads);
  }
  if (mayRead(deps, state) && searchIsDue(deps)) {
    await runUnderLease(deps, state, 'search', deps.searchCycle);
  }
  const day = utcDay(deps.now());
  if (!state.stopping && day !== state.lastRollupDay) {
    state.lastRollupDay = day;
    runLocal(deps, 'rollup', () => deps.dailyRollup(deps.now()));
  }
}

/**
 * Starts the loop: one look at once, then one every five minutes. A look that
 * comes while the one before is still working is dropped, so no two pieces of
 * work ever run at once here; the lease keeps other programs out as well. A
 * cycle that fails is recorded and the loop carries on.
 */
export function startScheduler(deps: SchedulerDeps): Scheduler {
  // The loop's memory lives here and nowhere else; it is lost on a restart,
  // after which the first look simply does whatever the store says is due.
  const state: LoopState = {
    lastReadAt: null,
    lastRollupDay: null,
    pausedUntil: null,
    stopping: false,
    running: null,
  };
  const look = (): void => {
    if (state.stopping || state.running !== null) return;
    state.running = tick(deps, state).finally(() => {
      state.running = null;
    });
  };
  const timer = (deps.every ?? defaultEvery)(look, SCHEDULER_TICK_MS);
  look();
  return {
    async stop() {
      state.stopping = true;
      (deps.stop ?? defaultStop)(timer);
      await state.running;
    },
    async whenIdle() {
      await state.running;
    },
  };
}

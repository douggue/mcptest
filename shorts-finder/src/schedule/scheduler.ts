/**
 * The loop that keeps the finder working all day: a round of readings every
 * hour, a round of searching whenever subjects are due, the owner's alerts
 * and daily messages, and the thinning of old readings once a day.
 *
 * It is a plain function over what it is given: the cycles, a clock and a
 * timer. It starts no process and knows nothing of settings; `service.ts`
 * builds what it is given.
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

export type CycleName = 'read' | 'channels' | 'search' | 'alerts' | 'daily' | 'rollup';

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
  /**
   * Tells the owner of findings that wait. Run in every look, after the
   * readings and the searching, which is when new findings appear; it reads
   * nothing from YouTube, so it needs no lease. Resolves to null when there
   * was nothing to try, and then nothing is recorded.
   */
  readonly alertCycle?: () => Promise<unknown>;
  /** The daily summary and the still-running line; null when neither was due. */
  readonly dailyMessages?: () => Promise<unknown>;
  /** Where the loop remembers when it last worked, so a restart carries on from there. */
  readonly memory?: SchedulerMemory;
  /** Where every outcome goes: done, failed or skipped. */
  readonly record: (entry: CycleRecord) => void;
  /** Replace the timer; used by tests. */
  readonly every?: (run: () => void, ms: number) => unknown;
  readonly stop?: (handle: unknown) => void;
}

/** A few named values that outlive the program: the store's `service_state`. */
export interface SchedulerMemory {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const LAST_READ_AT = 'scheduler.lastReadAt';
export const LAST_ROLLUP_DAY = 'scheduler.lastRollupDay';

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

/**
 * Runs work that reads nothing from YouTube and may have nothing to do: an
 * answer of null (or none) means it did not try, and is not recorded.
 */
async function runWhenDue(
  deps: SchedulerDeps,
  state: LoopState,
  cycle: CycleName,
  work: (() => Promise<unknown>) | undefined,
): Promise<void> {
  if (work === undefined || state.stopping) return;
  const startedAt = deps.now();
  try {
    const report = await work();
    if (report === null || report === undefined) return;
    record(deps, { cycle, startedAt, result: 'done', report, reason: null });
  } catch (error) {
    record(deps, { cycle, startedAt, result: 'failed', report: null, reason: reasonOf(error) });
  }
}

/** Notes a value for after a restart. Failing to must not stop the loop: it only costs a repeat. */
function remember(deps: SchedulerDeps, key: string, value: string): void {
  try {
    deps.memory?.set(key, value);
  } catch {
    // The store was busy or closed; the loop's own memory still holds the value.
  }
}

/** What the loop noted before the last restart; nothing when it cannot be read. */
function recall(deps: SchedulerDeps): Pick<LoopState, 'lastReadAt' | 'lastRollupDay'> {
  try {
    const readAt = new Date(deps.memory?.get(LAST_READ_AT) ?? '');
    // A time that is not one, or is still to come, would hold the readings back.
    const usable = Number.isFinite(readAt.getTime()) && readAt <= deps.now();
    return {
      lastReadAt: usable ? readAt : null,
      lastRollupDay: deps.memory?.get(LAST_ROLLUP_DAY) ?? null,
    };
  } catch {
    return { lastReadAt: null, lastRollupDay: null };
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

/**
 * One look at what is due: readings, then searching, then the owner's
 * messages, then the daily thinning. Never rejects.
 */
async function tick(deps: SchedulerDeps, state: LoopState): Promise<void> {
  const now = deps.now();
  const readDue =
    state.lastReadAt === null || now.getTime() - state.lastReadAt.getTime() >= READ_CYCLE_EVERY_MS;
  if (readDue && mayRead(deps, state)) {
    // A round that failed is not tried again until the next hour: a fault that
    // lasts would otherwise spend a unit per request every five minutes.
    if (await runUnderLease(deps, state, 'read', deps.readCycle)) {
      state.lastReadAt = now;
      remember(deps, LAST_READ_AT, now.toISOString());
    }
    if (mayRead(deps, state)) await runUnderLease(deps, state, 'channels', deps.channelReads);
  }
  if (mayRead(deps, state) && searchIsDue(deps)) {
    await runUnderLease(deps, state, 'search', deps.searchCycle);
  }
  await runWhenDue(deps, state, 'alerts', deps.alertCycle);
  await runWhenDue(deps, state, 'daily', deps.dailyMessages);
  const day = utcDay(deps.now());
  if (!state.stopping && day !== state.lastRollupDay) {
    state.lastRollupDay = day;
    remember(deps, LAST_ROLLUP_DAY, day);
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
  // Searching needs no memory here: each subject's last search is in the
  // store. The last round of readings and the last thinning are recalled, so
  // a restart within the hour does not read again at once.
  const state: LoopState = {
    ...recall(deps),
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

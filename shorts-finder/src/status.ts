/**
 * What the service knows about itself: how each round last went, the last
 * thing that went wrong, and the figures the daily messages and the `status`
 * command show. The outcomes are kept in the store's `service_state`, so a
 * command run by hand can read what the running service wrote.
 */
import { statSync } from 'node:fs';
import { z } from 'zod';
import type { ServiceStats } from './alerts/dailyMessages';
import type { LastProblem } from './alerts/format';
import { isFileStore } from './db/backup';
import { pacificDay } from './quota/ledger';
import type { QuotaRepo, ServiceStateRepo, TrackingRepo } from './repos/types';
import type { CycleName, CycleRecord } from './schedule/scheduler';
import { SEARCH_COST_UNITS } from './youtube/dataApi';

export const CYCLE_NAMES: readonly CycleName[] = [
  'read',
  'channels',
  'uploads',
  'search',
  'feeds',
  'alerts',
  'daily',
  'cleanup',
];

/** What each round is called when the owner is told of a problem in it. */
const CYCLE_WORDS: Readonly<Record<CycleName, string>> = {
  read: 'reading tracked videos',
  channels: 'reading channels',
  uploads: 'reading followed channels’ uploads',
  search: 'searching',
  feeds: 'reading followed channels’ feeds',
  alerts: 'sending alerts',
  daily: 'sending the daily messages',
  cleanup: 'cleaning up the store',
};

const LAST_PROBLEM = 'service.lastProblem';
const outcomeKey = (cycle: CycleName): string => `cycle.${cycle}`;
const MAX_REASON = 500;

const outcomeSchema = z.object({
  at: z.iso.datetime(),
  result: z.enum(['done', 'failed', 'skipped']),
  problem: z.string().nullable(),
});

const problemSchema = z.object({
  at: z.iso.datetime(),
  during: z.string(),
  reason: z.string(),
});

/** The parts of a round's report that tell of a fault inside a round that finished. */
const faultSchema = z.object({
  failure: z.string().nullable().optional(),
  failed: z.array(z.object({ reason: z.string() })).optional(),
  details: z.object({ failure: z.string().nullable() }).optional(),
});

/** How a round last went. */
export interface CycleOutcome {
  readonly at: Date;
  readonly result: CycleRecord['result'];
  /** What went wrong in it, if anything did. */
  readonly problem: string | null;
}

/** What went wrong in a round, whether it failed outright or finished with a fault. */
export function problemIn(entry: CycleRecord): string | null {
  if (entry.result === 'failed') return entry.reason ?? 'It failed without saying why';
  if (entry.result === 'skipped') return null;
  const report = faultSchema.safeParse(entry.report);
  if (!report.success) return null;
  if (typeof report.data.failure === 'string') return report.data.failure;
  if (typeof report.data.details?.failure === 'string') return report.data.details.failure;
  const failed = report.data.failed ?? [];
  const first = failed[0];
  if (first === undefined) return null;
  return failed.length === 1 ? first.reason : `${failed.length} failed; the first: ${first.reason}`;
}

/** Notes how a round went, and the problem in it as the last problem, if it had one. */
export function noteOutcome(state: ServiceStateRepo, entry: CycleRecord, now: Date): void {
  const problem = problemIn(entry)?.slice(0, MAX_REASON) ?? null;
  const at = entry.startedAt.toISOString();
  state.set(outcomeKey(entry.cycle), JSON.stringify({ at, result: entry.result, problem }), now);
  if (problem === null) return;
  const during = CYCLE_WORDS[entry.cycle];
  state.set(LAST_PROBLEM, JSON.stringify({ at, during, reason: problem }), now);
}

function parsed<T>(schema: z.ZodType<T>, text: string | null): T | null {
  if (text === null) return null;
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** How a round last went; null when it has never run (or its note cannot be read). */
export function readOutcome(state: ServiceStateRepo, cycle: CycleName): CycleOutcome | null {
  const outcome = parsed(outcomeSchema, state.get(outcomeKey(cycle)));
  return outcome === null ? null : { ...outcome, at: new Date(outcome.at) };
}

export function readLastProblem(state: ServiceStateRepo): LastProblem | null {
  const problem = parsed(problemSchema, state.get(LAST_PROBLEM));
  return problem === null ? null : { ...problem, at: new Date(problem.at) };
}

const sizeOf = (path: string): number => statSync(path, { throwIfNoEntry: false })?.size ?? 0;

/** The store's size on disk with its write-ahead log; null for a store in memory. */
export const storeBytes = (dbPath: string): number | null =>
  isFileStore(dbPath) ? sizeOf(dbPath) + sizeOf(`${dbPath}-wal`) : null;

export interface StatsSources {
  readonly quota: QuotaRepo;
  readonly tracking: TrackingRepo;
  readonly state: ServiceStateRepo;
  readonly dbPath: string;
  readonly dailyUnits: number;
}

/** The figures for the daily messages and the `status` command, as of `now`. */
export function gatherStats(sources: StatsSources, now: Date): ServiceStats {
  const usage = sources.quota.usage(pacificDay(now));
  const counts = sources.tracking.counts(now);
  return {
    unitsSpent: usage.unitsSpent,
    dailyUnits: sources.dailyUnits,
    unitsByKind: usage.byKind,
    // A search is 100 units and the read of its results 1, so the hundreds count the searches.
    searchesToday: Math.floor(usage.byKind.search / SEARCH_COST_UNITS),
    tracked: counts.tracked,
    dueUnread: counts.due,
    storeBytes: storeBytes(sources.dbPath),
    lastProblem: readLastProblem(sources.state),
  };
}

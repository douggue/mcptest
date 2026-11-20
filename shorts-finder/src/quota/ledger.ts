/**
 * The allowance ledger: what the key's daily allowance has been spent on, and
 * a plan that stops the caller before the API does.
 *
 * Every call to the API costs units (a search 100, most others 1), and Google
 * refuses everything once the day's units are gone. A refusal half way through
 * a round of readings leaves a hole in the history, so the scheduler asks the
 * ledger first and stops by itself. The day is the calendar day in Pacific
 * time, which is when Google resets the allowance.
 */
import { z } from 'zod';
import type { QuotaRepo } from '../repos/types';
import { QUOTA_KINDS, type QuotaKind } from './kinds';

/** Where Google's day starts and ends. A named zone, so daylight saving is followed. */
const QUOTA_TIME_ZONE = 'America/Los_Angeles';

/** The starting split from the plan: most of the day goes on searching. */
const PERCENT_OF_DAY = { search: 60, reading: 20, channel: 10 } as const;
const WHOLE = 100;

/** What a kind is called in a message to the owner. */
const KIND_LABELS: Readonly<Record<QuotaKind, string>> = {
  search: 'searches',
  reading: 'readings of tracked videos',
  channel: 'channel facts and upload lists',
  reserve: 'the units kept back',
};

export interface QuotaPlan {
  /** The most the day may cost in all. */
  readonly total: number;
  /** The most each kind may cost. A share may not exceed the total. */
  readonly shares: Readonly<Record<QuotaKind, number>>;
}

export interface Remaining {
  /** The calendar day in Pacific time, as YYYY-MM-DD. */
  readonly day: string;
  readonly total: number;
  /** What each kind may still spend: the rest of its share, or of the day if that is less. */
  readonly byKind: Readonly<Record<QuotaKind, number>>;
}

const share = z.number().int().nonnegative();

const planSchema = z
  .object({
    total: z.number().int().positive(),
    shares: z.object({ search: share, reading: share, channel: share, reserve: share }),
  })
  .refine((plan) => QUOTA_KINDS.every((kind) => plan.shares[kind] <= plan.total), {
    message: 'no share may be larger than the whole allowance',
  });

/** Checks a plan chosen by hand: whole units, none negative, no share above the total. */
export function createQuotaPlan(plan: QuotaPlan): QuotaPlan {
  const parsed = planSchema.safeParse(plan);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(`Invalid allowance plan. ${problems}`);
  }
  return parsed.data;
}

/**
 * The plan's split for a daily allowance: 60% searches, 20% readings, 10%
 * channels, and whatever is left (10%, plus any rounding) kept back.
 */
export function planFor(dailyUnits: number): QuotaPlan {
  const part = (percent: number): number => Math.floor((dailyUnits * percent) / WHOLE);
  const search = part(PERCENT_OF_DAY.search);
  const reading = part(PERCENT_OF_DAY.reading);
  const channel = part(PERCENT_OF_DAY.channel);
  const reserve = dailyUnits - search - reading - channel;
  return createQuotaPlan({ total: dailyUnits, shares: { search, reading, channel, reserve } });
}

/** 10,000 units: searches 6,000, readings 2,000, channels 1,000, kept back 1,000. */
export const DEFAULT_PLAN: QuotaPlan = planFor(10_000);

const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: QUOTA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar day in Pacific time that an instant falls on, as YYYY-MM-DD. */
export function pacificDay(at: Date): string {
  const parts = dayFormat.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Thrown when a spend would pass the plan. Nothing is recorded and no request should follow. */
export class AllowanceSpentError extends Error {
  constructor(
    readonly kind: QuotaKind,
    readonly units: number,
    readonly day: string,
  ) {
    super(
      `Today's allowance for ${KIND_LABELS[kind]} cannot cover ${units} more units. It resets at midnight Pacific time.`,
    );
    this.name = 'AllowanceSpentError';
  }
}

export interface QuotaLedger {
  /**
   * Records `units` against today and its kind. Throws an AllowanceSpentError,
   * recording nothing, when the kind's share or the day's total would be passed.
   */
  spend(kind: QuotaKind, units: number): void;
  /** Whether `units` of this kind still fit in the plan on the day of `now`. */
  canSpend(kind: QuotaKind, units: number, now: Date): boolean;
  /** What is left to spend on the day of `now`. */
  remaining(now: Date): Remaining;
}

export interface QuotaLedgerDeps {
  readonly repo: QuotaRepo;
  readonly plan: QuotaPlan;
  readonly now: () => Date;
}

function requireUnits(units: number): void {
  if (!Number.isInteger(units) || units <= 0) {
    throw new RangeError('Units spent must be a whole number above zero');
  }
}

function remainingOn(deps: QuotaLedgerDeps, now: Date): Remaining {
  const usage = deps.repo.usage(pacificDay(now));
  const total = Math.max(0, deps.plan.total - usage.unitsSpent);
  const left = (kind: QuotaKind): number =>
    Math.max(0, Math.min(total, deps.plan.shares[kind] - usage.byKind[kind]));
  return {
    day: usage.day,
    total,
    byKind: {
      search: left('search'),
      reading: left('reading'),
      channel: left('channel'),
      reserve: left('reserve'),
    },
  };
}

/** The ledger over a store and a plan. `spend` is what the API client is given to call. */
export function createQuotaLedger(deps: QuotaLedgerDeps): QuotaLedger {
  return {
    spend(kind, units) {
      requireUnits(units);
      const day = pacificDay(deps.now());
      const limits = { kind: deps.plan.shares[kind], total: deps.plan.total };
      if (!deps.repo.spendWithin(day, kind, units, limits)) {
        throw new AllowanceSpentError(kind, units, day);
      }
    },
    canSpend(kind, units, now) {
      requireUnits(units);
      return remainingOn(deps, now).byKind[kind] >= units;
    },
    remaining: (now) => remainingOn(deps, now),
  };
}

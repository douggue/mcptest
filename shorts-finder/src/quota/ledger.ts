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
import type { QuotaRepo, SpendLimits } from '../repos/types';
import { QUOTA_KINDS, type QuotaKind } from './kinds';

/** Where Google's day starts and ends. A named zone, so daylight saving is followed. */
const QUOTA_TIME_ZONE = 'America/Los_Angeles';

/** The starting split from the plan: most of the day goes on searching. */
const PERCENT_OF_DAY = { search: 60, reading: 20, channel: 10 } as const;
const WHOLE = 100;

const SECONDS_PER_HOUR = 3600;
const HOURS_PER_DAY = 24;
/**
 * In the last three hours of the Pacific day, units the searches and the
 * channel reads have not spent may be spent on readings. By then the day's
 * searching is done or will not be, units left at midnight are lost, and the
 * readings are what run short late in the day. Three hours is three rounds of
 * readings: enough to use what is left, late enough that a search due in the
 * afternoon has had its turn. Until then every share is a hard wall.
 */
export const LATE_DAY_FLOW_HOURS = 3;
/** The kinds whose unspent units can flow to the readings, and the readings themselves. */
const FLOW_POOL: readonly QuotaKind[] = ['search', 'channel', 'reading'];

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
  /**
   * What each kind may still spend: the rest of its share, or of the day if
   * that is less. Late in the Pacific day the readings' figure also counts
   * what the searches and the channel reads have left.
   */
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

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: QUOTA_TIME_ZONE,
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * The hours left of the Pacific day at an instant, by the clock on the wall:
 * 24 at midnight, a little above 0 just before the next. On the two days a
 * year the clocks change it is an hour out until the change has happened,
 * which only moves the late-day window by that hour.
 */
export function pacificHoursLeft(at: Date): number {
  const parts = clockFormat.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((entry) => entry.type === type)?.value ?? '0');
  const elapsed = part('hour') * SECONDS_PER_HOUR + part('minute') * 60 + part('second');
  return HOURS_PER_DAY - elapsed / SECONDS_PER_HOUR;
}

/** Whether unspent search and channel units may be spent on readings at this instant. */
export const isLateInPacificDay = (at: Date): boolean =>
  pacificHoursLeft(at) <= LATE_DAY_FLOW_HOURS;

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
   * recording nothing, when the kind's share or the day's total would be
   * passed. In the last hours of the Pacific day a reading may also be paid
   * from what the searches and the channel reads have not spent.
   */
  spend(kind: QuotaKind, units: number): void;
  /**
   * Records that Google itself refused a request because today's allowance is
   * gone: the key was used elsewhere, or the allowance is smaller than the
   * plan. Nothing more of any kind is spent until the day turns.
   */
  markExhausted(): void;
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

const sumOf = (figures: Readonly<Record<QuotaKind, number>>, kinds: readonly QuotaKind[]): number =>
  kinds.reduce((sum, kind) => sum + figures[kind], 0);

function remainingOn(deps: QuotaLedgerDeps, now: Date): Remaining {
  const usage = deps.repo.usage(pacificDay(now));
  const total = Math.max(0, deps.plan.total - usage.unitsSpent);
  // What the three kinds that share units late in the day have left between
  // them. It bounds each of them at all times, so units the readings have
  // borrowed are not also spent by the kind that lent them.
  const pool = sumOf(deps.plan.shares, FLOW_POOL) - sumOf(usage.byKind, FLOW_POOL);
  const own = (kind: QuotaKind): number => deps.plan.shares[kind] - usage.byKind[kind];
  const left = (kind: QuotaKind, most: number): number =>
    Math.max(0, Math.min(total, most, kind === 'reserve' ? most : pool));
  return {
    day: usage.day,
    total,
    byKind: {
      search: left('search', own('search')),
      reading: left('reading', isLateInPacificDay(now) ? pool : own('reading')),
      channel: left('channel', own('channel')),
      reserve: left('reserve', own('reserve')),
    },
  };
}

/** The limits one spend is held to. Late in the day only the shared limit binds the readings. */
function limitsFor(deps: QuotaLedgerDeps, kind: QuotaKind, now: Date): SpendLimits {
  const { shares, total } = deps.plan;
  if (kind === 'reserve') return { kind: shares.reserve, total };
  const pooled = { kinds: FLOW_POOL, limit: sumOf(shares, FLOW_POOL) };
  const lent = kind === 'reading' && isLateInPacificDay(now);
  return { kind: lent ? pooled.limit : shares[kind], total, pooled };
}

/** The ledger over a store and a plan. `spend` is what the API client is given to call. */
export function createQuotaLedger(deps: QuotaLedgerDeps): QuotaLedger {
  return {
    spend(kind, units) {
      requireUnits(units);
      const now = deps.now();
      const day = pacificDay(now);
      if (!deps.repo.spendWithin(day, kind, units, limitsFor(deps, kind, now))) {
        throw new AllowanceSpentError(kind, units, day);
      }
    },
    markExhausted() {
      deps.repo.exhaust(pacificDay(deps.now()), deps.plan.total);
    },
    canSpend(kind, units, now) {
      requireUnits(units);
      return remainingOn(deps, now).byKind[kind] >= units;
    },
    remaining: (now) => remainingOn(deps, now),
  };
}

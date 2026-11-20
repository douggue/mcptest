import type { QuotaKind } from '../quota/kinds';

/** Runs the given writes as one: all of them are stored, or none. */
export type Transact = (work: () => void) => void;

/**
 * The right to read YouTube. One piece of work holds it at a time, across
 * every program that has the store open; see `withYouTubeLease`.
 */
export interface LeaseRepo {
  /** Takes the lease when it is free or has run out. False when other work holds it. */
  acquire(owner: string, now: Date, expiresAt: Date): boolean;
  /** Holds the lease for longer. False when `owner` does not hold it. */
  renew(owner: string, expiresAt: Date): boolean;
  /** Gives the lease back; does nothing when `owner` does not hold it. */
  release(owner: string): void;
  /** Who holds the lease at `now`; null when it is free or has run out. */
  holder(now: Date): string | null;
}

/** What one day's API calls cost, in units of the key's allowance. */
export interface DayUsage {
  /** The calendar day in Pacific time, as YYYY-MM-DD. */
  readonly day: string;
  readonly unitsSpent: number;
  readonly byKind: Readonly<Record<QuotaKind, number>>;
}

/** The most a day may reach, for one kind of call and for all of them together. */
export interface SpendLimits {
  readonly kind: number;
  readonly total: number;
}

/** The record of units spent, one row a day. */
export interface QuotaRepo {
  /** What was spent on `day`; all zeros for a day nothing was spent on. */
  usage(day: string): DayUsage;
  /**
   * Adds `units` to the day and to its kind, unless either would pass its
   * limit: then nothing is added and the answer is false. Checked and written
   * as one step, so two programs cannot both spend the last units.
   */
  spendWithin(day: string, kind: QuotaKind, units: number, limits: SpendLimits): boolean;
}

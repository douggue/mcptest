/**
 * How a sweep reads: every search, channel and sidebar is charged to the
 * day's budget before it is asked for, at the most it can take, and is not
 * asked for at all when the budget cannot cover it. A refusal from YouTube
 * and several failures in a row each end the sweep.
 */
import { addPots, covers, NO_SPEND, type Pots } from './budget';
import { isRefusal, REFUSED_MESSAGE } from './refusal';
import type { SweepStop } from './types';

/** Reads that may fail one after another before the sweep gives up. */
export const SWEEP_MAX_FAILURES_IN_A_ROW = 5;
const PROBLEMS_KEPT = 5;

export interface Stop {
  readonly stopped: Exclude<SweepStop, 'done'>;
  readonly message: string;
}

export type Attempt<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'failed' }
  | { readonly kind: 'stop'; readonly stop: Stop };

export interface ReadCost {
  /** Charged before the read. */
  readonly cost: Pots;
  /** What must be affordable for the read to be worth starting; the cost unless given. */
  readonly needs?: Pots;
  /** What this read must leave untouched for a later step. */
  readonly reserve?: Pots;
  /** Counts what the read really spent, to replace the charge; for the API, which is counted exactly. */
  readonly counted?: () => Pots;
}

export interface SweepReader {
  attempt<T>(price: ReadCost, work: () => Promise<T>): Promise<Attempt<T>>;
  spent(): Pots;
  problems(): readonly string[];
}

const minus = (a: Pots, b: Pots): Pots => ({ pages: a.pages - b.pages, units: a.units - b.units });

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const BUDGET_STOP: Stop = { stopped: 'budget', message: 'Today’s reading budget is used.' };
const REFUSED_STOP: Stop = { stopped: 'refused', message: REFUSED_MESSAGE };

const failedStop = (reason: string): Stop => ({
  stopped: 'failed',
  message: `${SWEEP_MAX_FAILURES_IN_A_ROW} reads in a row failed, so the sweep stopped: ${reason}`,
});

/** A reader over what is left of today's budget; `onSpend` is told the total after every change. */
export function sweepReader(left: Pots, onSpend: (spent: Pots) => void): SweepReader {
  let spent: Pots = NO_SPEND;
  let failuresInARow = 0;
  let problems: readonly string[] = [];
  const set = (next: Pots): void => {
    spent = next;
    onSpend(spent);
  };
  const failed = (error: unknown): Attempt<never> => {
    if (isRefusal(error)) return { kind: 'stop', stop: REFUSED_STOP };
    failuresInARow += 1;
    problems = [...problems, messageOf(error)].slice(0, PROBLEMS_KEPT);
    return failuresInARow >= SWEEP_MAX_FAILURES_IN_A_ROW
      ? { kind: 'stop', stop: failedStop(messageOf(error)) }
      : { kind: 'failed' };
  };
  return {
    async attempt(price, work) {
      const free = minus(minus(left, spent), price.reserve ?? NO_SPEND);
      if (!covers(free, price.needs ?? price.cost)) return { kind: 'stop', stop: BUDGET_STOP };
      const before = spent;
      set(addPots(spent, price.cost));
      try {
        const value = await work();
        failuresInARow = 0;
        return { kind: 'ok', value };
      } catch (error) {
        return failed(error);
      } finally {
        if (price.counted) set(addPots(before, price.counted()));
      }
    },
    spent: () => spent,
    problems: () => problems,
  };
}

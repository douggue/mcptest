import { z } from 'zod';
import type { Db } from '../db/sqlite';
import type { QuotaKind } from '../quota/kinds';
import type { DayUsage, QuotaRepo, SpendLimits } from './types';

const units = z.number().int().nonnegative();

/** The per-kind figures as they are stored. A kind added later reads as zero in older rows. */
const byKindSchema = z.object({
  search: units.default(0),
  reading: units.default(0),
  channel: units.default(0),
  reserve: units.default(0),
});

const NOTHING_SPENT: Readonly<Record<QuotaKind, number>> = {
  search: 0,
  reading: 0,
  channel: 0,
  reserve: 0,
};

interface LedgerRow {
  readonly units_spent: number;
  readonly by_kind: string;
}

function readByKind(day: string, text: string): Readonly<Record<QuotaKind, number>> {
  try {
    return byKindSchema.parse(JSON.parse(text));
  } catch (error) {
    // Guessing zero here would let the day be spent twice.
    throw new Error(`The allowance ledger for ${day} cannot be read`, { cause: error });
  }
}

/** The allowance ledger as one row a day in the store. */
export class SqliteQuotaRepo implements QuotaRepo {
  constructor(private readonly db: Db) {}

  usage(day: string): DayUsage {
    const row = this.db
      .prepare<[string], LedgerRow>('SELECT units_spent, by_kind FROM quota_ledger WHERE day = ?')
      .get(day);
    if (row === undefined) return { day, unitsSpent: 0, byKind: NOTHING_SPENT };
    return { day, unitsSpent: row.units_spent, byKind: readByKind(day, row.by_kind) };
  }

  spendWithin(day: string, kind: QuotaKind, amount: number, limits: SpendLimits): boolean {
    // Read and written under the write lock, so no other program spends in between.
    return this.db
      .transaction((): boolean => {
        const before = this.usage(day);
        const total = before.unitsSpent + amount;
        const ofKind = before.byKind[kind] + amount;
        if (total > limits.total || ofKind > limits.kind) return false;
        const pool = limits.pooled;
        const inPool = (pool?.kinds ?? []).reduce((sum, each) => sum + before.byKind[each], 0);
        if (pool !== undefined && inPool + amount > pool.limit) return false;
        this.write(day, total, { ...before.byKind, [kind]: ofKind });
        return true;
      })
      .immediate();
  }

  exhaust(day: string, total: number): void {
    this.db
      .transaction((): void => {
        const before = this.usage(day);
        if (before.unitsSpent >= total) return;
        this.write(day, total, before.byKind);
      })
      .immediate();
  }

  private write(day: string, total: number, byKind: Readonly<Record<QuotaKind, number>>): void {
    this.db
      .prepare(
        `INSERT INTO quota_ledger (day, units_spent, by_kind) VALUES (?, ?, ?)
         ON CONFLICT (day) DO UPDATE SET
           units_spent = excluded.units_spent, by_kind = excluded.by_kind`,
      )
      .run(day, total, JSON.stringify(byKind));
  }
}

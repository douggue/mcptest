import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import {
  AllowanceSpentError,
  DEFAULT_PLAN,
  createQuotaLedger,
  createQuotaPlan,
  pacificDay,
  planFor,
  type QuotaLedger,
  type QuotaPlan,
} from '../src/quota/ledger';
import { SqliteQuotaRepo } from '../src/repos/sqliteQuotaRepo';

/** Noon in Los Angeles on 20 November 2026, when Pacific time is eight hours behind UTC. */
const NOON = new Date('2026-11-20T20:00:00Z');
const DAY = '2026-11-20';

let db: Db;
let repo: SqliteQuotaRepo;
let clock: Date;

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new SqliteQuotaRepo(db);
  clock = NOON;
});

afterEach(() => {
  db.close();
});

const ledgerWith = (plan: QuotaPlan = DEFAULT_PLAN): QuotaLedger =>
  createQuotaLedger({ repo, plan, now: () => clock });

describe('pacificDay', () => {
  test.each([
    ['the last second of a winter day', '2026-11-20T07:59:59Z', '2026-11-19'],
    ['midnight in winter, eight hours behind UTC', '2026-11-20T08:00:00Z', '2026-11-20'],
    ['the last second of a summer day', '2026-07-01T06:59:59Z', '2026-06-30'],
    ['midnight in summer, seven hours behind UTC', '2026-07-01T07:00:00Z', '2026-07-01'],
    ['the end of the day the clocks go forward', '2026-03-09T06:59:59Z', '2026-03-08'],
    ['the end of the day the clocks go back', '2026-11-02T07:59:59Z', '2026-11-01'],
    ['the first second of a year', '2027-01-01T08:00:00Z', '2027-01-01'],
  ])('reads %s', (_what, instant, day) => {
    expect(pacificDay(new Date(instant))).toBe(day);
  });
});

describe('planFor', () => {
  test("splits the default allowance as the plan's table does", () => {
    expect(planFor(10_000)).toEqual({
      total: 10_000,
      shares: { search: 6000, reading: 2000, channel: 1000, reserve: 1000 },
    });
    expect(DEFAULT_PLAN).toEqual(planFor(10_000));
  });

  test('keeps the same proportions for another allowance, with the remainder kept back', () => {
    expect(planFor(5000).shares).toEqual({
      search: 3000,
      reading: 1000,
      channel: 500,
      reserve: 500,
    });
    expect(planFor(1001).shares).toEqual({ search: 600, reading: 200, channel: 100, reserve: 101 });
  });
});

describe('createQuotaPlan', () => {
  test('accepts a split chosen by hand', () => {
    const plan = createQuotaPlan({
      total: 500,
      shares: { search: 300, reading: 100, channel: 50, reserve: 50 },
    });

    expect(plan.shares.search).toBe(300);
  });

  test.each([
    ['a share larger than the whole allowance', { total: 100, search: 200 }],
    ['a negative share', { total: 100, search: -1 }],
    ['a fractional share', { total: 100, search: 1.5 }],
    ['no allowance at all', { total: 0, search: 0 }],
  ])('refuses %s', (_what, { total, search }) => {
    expect(() =>
      createQuotaPlan({ total, shares: { search, reading: 0, channel: 0, reserve: 0 } }),
    ).toThrow(/allowance plan/);
  });
});

describe('the allowance ledger', () => {
  test('starts the day with the whole plan to spend', () => {
    const ledger = ledgerWith();

    expect(ledger.remaining(NOON)).toEqual({
      day: DAY,
      total: 10_000,
      byKind: { search: 6000, reading: 2000, channel: 1000, reserve: 1000 },
    });
  });

  test("adds what is spent to the day's total and to its kind", () => {
    const ledger = ledgerWith();

    ledger.spend('search', 100);
    ledger.spend('search', 100);
    ledger.spend('reading', 3);

    expect(repo.usage(DAY)).toEqual({
      day: DAY,
      unitsSpent: 203,
      byKind: { search: 200, reading: 3, channel: 0, reserve: 0 },
    });
    expect(ledger.remaining(NOON)).toEqual({
      day: DAY,
      total: 9797,
      byKind: { search: 5800, reading: 1997, channel: 1000, reserve: 1000 },
    });
  });

  test('keeps the per-kind figures as readable JSON beside the total', () => {
    ledgerWith().spend('channel', 2);

    const row = db.prepare('SELECT day, units_spent, by_kind FROM quota_ledger').get() as {
      by_kind: string;
    };

    expect(row).toMatchObject({ day: DAY, units_spent: 2 });
    expect(JSON.parse(row.by_kind)).toEqual({ search: 0, reading: 0, channel: 2, reserve: 0 });
  });

  test("refuses once a kind's share is used, though the day's total has room", () => {
    const ledger = ledgerWith();
    ledger.spend('channel', 1000);

    expect(ledger.canSpend('channel', 1, NOON)).toBe(false);
    expect(ledger.canSpend('reading', 1, NOON)).toBe(true);
    expect(ledger.remaining(NOON).byKind.channel).toBe(0);
  });

  test("refuses when the day's total would be passed, though the kind has room", () => {
    const overlapping = createQuotaPlan({
      total: 300,
      shares: { search: 300, reading: 200, channel: 0, reserve: 0 },
    });
    const ledger = ledgerWith(overlapping);
    ledger.spend('search', 200);

    expect(ledger.canSpend('reading', 101, NOON)).toBe(false);
    expect(ledger.canSpend('reading', 100, NOON)).toBe(true);
    expect(ledger.remaining(NOON).byKind.reading).toBe(100);
  });

  test('lets a spend through that lands exactly on the share', () => {
    const ledger = ledgerWith();

    expect(ledger.canSpend('search', 6000, NOON)).toBe(true);
    expect(ledger.canSpend('search', 6001, NOON)).toBe(false);
  });

  test('throws, and records nothing, when asked to spend past the plan', () => {
    const ledger = ledgerWith();
    ledger.spend('search', 5950);

    const attempt = () => ledger.spend('search', 100);

    expect(attempt).toThrow(AllowanceSpentError);
    expect(attempt).toThrow(/searches.*midnight Pacific time/);
    expect(repo.usage(DAY).unitsSpent).toBe(5950);
  });

  test('says which kind and day ran out, for the caller to act on', () => {
    const ledger = ledgerWith(planFor(100));
    let caught: unknown;

    try {
      ledger.spend('search', 100);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ name: 'AllowanceSpentError', kind: 'search', day: DAY });
  });

  test('starts again from nothing at midnight Pacific time', () => {
    const ledger = ledgerWith();
    ledger.spend('search', 6000);

    clock = new Date('2026-11-21T08:00:00Z');

    expect(ledger.canSpend('search', 100, clock)).toBe(true);
    ledger.spend('search', 100);
    expect(repo.usage('2026-11-21').unitsSpent).toBe(100);
    expect(repo.usage(DAY).unitsSpent).toBe(6000);
  });

  test.each([0, -5, 1.5, Number.NaN])('refuses to count %s units', (units) => {
    const ledger = ledgerWith();

    expect(() => ledger.spend('search', units)).toThrow(RangeError);
    expect(() => ledger.canSpend('search', units, NOON)).toThrow(RangeError);
  });
});

describe('SqliteQuotaRepo', () => {
  test('reports a day nothing was spent on as all zeros', () => {
    expect(repo.usage('2026-01-01')).toEqual({
      day: '2026-01-01',
      unitsSpent: 0,
      byKind: { search: 0, reading: 0, channel: 0, reserve: 0 },
    });
  });

  test('adds nothing and says no when a limit would be passed', () => {
    const spent = repo.spendWithin(DAY, 'search', 100, { kind: 99, total: 1000 });

    expect(spent).toBe(false);
    expect(repo.usage(DAY).unitsSpent).toBe(0);
  });

  test('refuses to guess when the stored figures cannot be read', () => {
    db.prepare(
      `INSERT INTO quota_ledger (day, units_spent, by_kind) VALUES (?, 5, 'not json')`,
    ).run(DAY);

    expect(() => repo.usage(DAY)).toThrow(/allowance ledger for 2026-11-20 cannot be read/);
  });
});

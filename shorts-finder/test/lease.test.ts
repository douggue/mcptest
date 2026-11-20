import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase, type Db } from '../src/db/sqlite';
import {
  READING_ELSEWHERE,
  ReadingElsewhereError,
  YOUTUBE_LEASE_RENEW_MS,
  YOUTUBE_LEASE_TTL_MS,
  withYouTubeLease,
  type LeaseDeps,
} from '../src/lease';
import { SqliteLeaseRepo } from '../src/repos/sqliteLeaseRepo';

const NOW = new Date('2026-11-20T12:00:00Z');
const after = (ms: number) => new Date(NOW.getTime() + ms);
const MINUTE_MS = 60_000;

let db: Db;
let leases: SqliteLeaseRepo;

beforeEach(() => {
  db = openDatabase(':memory:');
  leases = new SqliteLeaseRepo(db);
});

afterEach(() => {
  if (db.open) db.close();
});

/** Lease settings with a clock the test moves and a beat the test fires by hand. */
function manualDeps(owner: string) {
  const state = { now: NOW, beats: [] as Array<() => void>, stopped: 0, everyMs: 0 };
  const deps: LeaseDeps = {
    leases,
    now: () => state.now,
    newOwner: () => owner,
    every: (run, ms) => {
      state.beats.push(run);
      state.everyMs = ms;
      return 'beat';
    },
    stop: () => {
      state.stopped += 1;
    },
  };
  return { deps, state };
}

describe('SqliteLeaseRepo', () => {
  test('gives the lease to the first to ask and refuses the next', () => {
    expect(leases.holder(NOW)).toBeNull();

    expect(leases.acquire('scheduler', NOW, after(2 * MINUTE_MS))).toBe(true);
    expect(leases.acquire('by-hand', after(MINUTE_MS), after(3 * MINUTE_MS))).toBe(false);

    expect(leases.holder(after(MINUTE_MS))).toBe('scheduler');
  });

  test('lets go of a lease whose holder stopped renewing it: it runs out by itself', () => {
    leases.acquire('died', NOW, after(2 * MINUTE_MS));

    expect(leases.holder(after(2 * MINUTE_MS))).toBeNull();
    expect(leases.acquire('next', after(2 * MINUTE_MS), after(4 * MINUTE_MS))).toBe(true);
    expect(leases.holder(after(3 * MINUTE_MS))).toBe('next');
  });

  test('keeps the lease with a holder that renews it', () => {
    leases.acquire('scheduler', NOW, after(2 * MINUTE_MS));

    expect(leases.renew('scheduler', after(5 * MINUTE_MS))).toBe(true);

    expect(leases.acquire('by-hand', after(3 * MINUTE_MS), after(6 * MINUTE_MS))).toBe(false);
  });

  test('does not renew or release a lease for work that does not hold it', () => {
    leases.acquire('scheduler', NOW, after(2 * MINUTE_MS));

    expect(leases.renew('by-hand', after(5 * MINUTE_MS))).toBe(false);
    leases.release('by-hand');

    expect(leases.holder(after(MINUTE_MS))).toBe('scheduler');
  });

  test('frees the lease at once when its holder gives it back', () => {
    leases.acquire('scheduler', NOW, after(2 * MINUTE_MS));

    leases.release('scheduler');

    expect(leases.holder(NOW)).toBeNull();
  });
});

describe('withYouTubeLease', () => {
  test('holds the lease while the work runs and gives it back after', async () => {
    const { deps, state } = manualDeps('scheduler');

    const result = await withYouTubeLease(deps, async () => leases.holder(NOW));

    expect(result).toBe('scheduler');
    expect(leases.holder(NOW)).toBeNull();
    expect(state.stopped).toBe(1);
    expect(state.everyMs).toBe(YOUTUBE_LEASE_RENEW_MS);
  });

  test('refuses, without starting the work, when other work holds the lease', async () => {
    leases.acquire('other', NOW, after(YOUTUBE_LEASE_TTL_MS));
    const { deps } = manualDeps('scheduler');
    let started = false;

    const attempt = withYouTubeLease(deps, async () => {
      started = true;
    });

    await expect(attempt).rejects.toBeInstanceOf(ReadingElsewhereError);
    await expect(attempt).rejects.toThrow(READING_ELSEWHERE);
    expect(started).toBe(false);
    expect(leases.holder(NOW)).toBe('other');
  });

  test('renews the lease on every beat, so long work keeps it', async () => {
    const { deps, state } = manualDeps('scheduler');

    await withYouTubeLease(deps, async () => {
      state.now = after(YOUTUBE_LEASE_TTL_MS - 1);
      state.beats[0]?.();

      expect(leases.holder(after(YOUTUBE_LEASE_TTL_MS + MINUTE_MS))).toBe('scheduler');
    });
  });

  test('gives the lease back when the work fails, and passes the failure on', async () => {
    const { deps } = manualDeps('scheduler');

    const attempt = withYouTubeLease(deps, async () => {
      throw new Error('the reading failed');
    });

    await expect(attempt).rejects.toThrow('the reading failed');
    expect(leases.holder(NOW)).toBeNull();
  });

  test('carries on when the store is closed under the work', async () => {
    const { deps, state } = manualDeps('scheduler');

    const result = await withYouTubeLease(deps, async () => {
      db.close();
      state.beats[0]?.();
      return 'done';
    });

    expect(result).toBe('done');
  });

  test('runs on its own clock and owner name when none are given', async () => {
    const result = await withYouTubeLease({ leases, now: () => NOW }, async () => {
      const holder = leases.holder(NOW);
      return holder;
    });

    expect(result).toMatch(/^[0-9a-f-]{36}$/);
    expect(leases.holder(NOW)).toBeNull();
  });
});

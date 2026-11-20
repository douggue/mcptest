import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
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

let folder: string;
let storePath: string;
let db: Db;
let leases: SqliteLeaseRepo;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-lease-'));
  storePath = join(folder, 'jgtube.db');
  db = openDatabase(storePath);
  leases = new SqliteLeaseRepo(db);
});

afterEach(() => {
  db.close();
  rmSync(folder, { recursive: true, force: true });
});

describe('SqliteLeaseRepo', () => {
  test('gives the lease to the first to ask and refuses the next', () => {
    expect(leases.holder(NOW)).toBeNull();

    expect(leases.acquire('web', NOW, after(2 * MINUTE_MS))).toBe(true);
    expect(leases.acquire('connector', after(MINUTE_MS), after(3 * MINUTE_MS))).toBe(false);

    expect(leases.holder(after(MINUTE_MS))).toBe('web');
  });

  test('lets go of a lease whose holder stopped renewing it: it runs out by itself', () => {
    leases.acquire('died', NOW, after(2 * MINUTE_MS));

    expect(leases.holder(after(2 * MINUTE_MS))).toBeNull();
    expect(leases.acquire('next', after(2 * MINUTE_MS), after(4 * MINUTE_MS))).toBe(true);
    expect(leases.holder(after(3 * MINUTE_MS))).toBe('next');
  });

  test('keeps the lease with a holder that renews it', () => {
    leases.acquire('web', NOW, after(2 * MINUTE_MS));

    expect(leases.renew('web', after(5 * MINUTE_MS))).toBe(true);

    expect(leases.acquire('connector', after(3 * MINUTE_MS), after(6 * MINUTE_MS))).toBe(false);
    expect(leases.renew('connector', after(9 * MINUTE_MS))).toBe(false);
    expect(leases.holder(after(4 * MINUTE_MS))).toBe('web');
  });

  test('frees the lease when its holder is done, and only then', () => {
    leases.acquire('web', NOW, after(2 * MINUTE_MS));

    leases.release('connector');
    expect(leases.holder(NOW)).toBe('web');
    leases.release('web');

    expect(leases.holder(NOW)).toBeNull();
    expect(leases.acquire('connector', NOW, after(2 * MINUTE_MS))).toBe(true);
  });

  test('is seen by another program that has the same store open', () => {
    const other = openDatabase(storePath);
    const theirs = new SqliteLeaseRepo(other);

    leases.acquire('web', NOW, after(2 * MINUTE_MS));

    expect(theirs.holder(NOW)).toBe('web');
    expect(theirs.acquire('connector', NOW, after(2 * MINUTE_MS))).toBe(false);
    leases.release('web');
    expect(theirs.acquire('connector', NOW, after(2 * MINUTE_MS))).toBe(true);
    other.close();
  });
});

describe('withYouTubeLease', () => {
  /** A heartbeat the test beats by hand. */
  function world(now: () => Date = () => NOW) {
    let beat: (() => void) | null = null;
    const intervals: number[] = [];
    let next = 0;
    const deps: LeaseDeps = {
      leases,
      now,
      newOwner: () => `owner-${(next += 1)}`,
      every: (run, ms) => {
        beat = run;
        intervals.push(ms);
        return 'beat';
      },
      stop: () => {
        beat = null;
      },
    };
    return { deps, intervals, beat: () => beat?.(), isBeating: () => beat !== null };
  }

  test('holds the lease while the work runs and frees it afterwards', async () => {
    const { deps, isBeating } = world();

    const result = await withYouTubeLease(deps, async () => {
      expect(leases.holder(NOW)).toBe('owner-1');
      return 'read';
    });

    expect(result).toBe('read');
    expect(leases.holder(NOW)).toBeNull();
    expect(isBeating()).toBe(false);
  });

  test('frees the lease when the work fails', async () => {
    const { deps, isBeating } = world();

    await expect(
      withYouTubeLease(deps, () => Promise.reject(new Error('refused'))),
    ).rejects.toThrow('refused');

    expect(leases.holder(NOW)).toBeNull();
    expect(isBeating()).toBe(false);
  });

  test('refuses, without starting the work, while another holds the lease', async () => {
    const { deps } = world();
    leases.acquire('another-process', NOW, after(YOUTUBE_LEASE_TTL_MS));
    let started = false;

    const attempt = withYouTubeLease(deps, async () => {
      started = true;
    });

    await expect(attempt).rejects.toBeInstanceOf(ReadingElsewhereError);
    await expect(attempt).rejects.toThrow(READING_ELSEWHERE);
    expect(READING_ELSEWHERE).toMatch(/already reading YouTube in another window or process/);
    expect(started).toBe(false);
    expect(leases.holder(NOW)).toBe('another-process');
  });

  test('refuses a second piece of work in the same program too', async () => {
    const { deps } = world();
    let finish: () => void = () => {};
    const first = withYouTubeLease(deps, () => new Promise<void>((done) => (finish = done)));

    await expect(withYouTubeLease(deps, async () => {})).rejects.toBeInstanceOf(
      ReadingElsewhereError,
    );
    finish();
    await first;

    await expect(withYouTubeLease(deps, async () => 'now free')).resolves.toBe('now free');
  });

  test('renews the lease while the work runs, so long work is not taken for dead', async () => {
    let clock = NOW;
    const { deps, intervals, beat } = world(() => clock);

    await withYouTubeLease(deps, async () => {
      clock = after(YOUTUBE_LEASE_TTL_MS - 1000);
      beat();
      clock = after(YOUTUBE_LEASE_TTL_MS + 5000);
      expect(leases.holder(clock)).toBe('owner-1');
    });

    expect(intervals).toEqual([YOUTUBE_LEASE_RENEW_MS]);
    expect(YOUTUBE_LEASE_RENEW_MS * 2).toBeLessThan(YOUTUBE_LEASE_TTL_MS);
  });

  test('takes over from work that stopped renewing', async () => {
    const { deps } = world(() => after(YOUTUBE_LEASE_TTL_MS));
    leases.acquire('died', NOW, after(YOUTUBE_LEASE_TTL_MS));

    await expect(withYouTubeLease(deps, async () => 'took over')).resolves.toBe('took over');
  });

  test('carries on when a renewal cannot be written', async () => {
    const { deps, beat } = world();
    const broken: LeaseDeps = {
      ...deps,
      leases: Object.assign(Object.create(leases) as SqliteLeaseRepo, {
        renew: () => {
          throw new Error('store is busy');
        },
      }),
    };

    await expect(
      withYouTubeLease(broken, async () => {
        beat();
        return 'finished';
      }),
    ).resolves.toBe('finished');
  });

  test('beats on the real clock when given none', async () => {
    await expect(withYouTubeLease({ leases, now: () => NOW }, async () => 'done')).resolves.toBe(
      'done',
    );
    expect(leases.holder(NOW)).toBeNull();
  });
});

describe('npm run refresh, while another program is reading YouTube', () => {
  const run = promisify(execFile);
  const root = resolve(import.meta.dirname, '../../..');

  test('is refused before it connects to anything', async () => {
    const farAhead = new Date(Date.now() + 60 * MINUTE_MS);
    leases.acquire('the-web-app', new Date(), farAhead);

    const attempt = run(
      process.execPath,
      [
        join(root, 'node_modules/tsx/dist/cli.mjs'),
        join(root, 'packages/core/src/cli.ts'),
        'refresh',
      ],
      {
        cwd: folder,
        env: {
          PATH: process.env['PATH'],
          JGTUBE_DB_PATH: storePath,
          // Belt and braces: the network is switched off in the child and in
          // what it starts, so even a regression could not reach YouTube.
          NODE_OPTIONS: `--import=${pathToFileURL(join(root, 'packages/core/test/fixtures/no-network.mjs')).href}`,
        },
      },
    );

    await expect(attempt).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('already reading YouTube in another window or process'),
    });
    expect(leases.holder(new Date())).toBe('the-web-app');
  }, 30_000);
});

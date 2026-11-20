import { randomUUID } from 'node:crypto';
import type { LeaseRepo } from './repos/types';

/**
 * One piece of work at a time reads YouTube, whichever program starts it.
 *
 * The service and a command run by hand each open the same store, and each
 * can start a search or a round of readings. Two at once would spend the API
 * allowance twice as fast as the plan expects. A guard inside one program
 * cannot see the others, so the right to read YouTube is a lease kept in the
 * store itself: taken before the work, renewed while it runs, given back
 * after. A program that dies stops renewing, and its lease runs out by itself.
 *
 * Work that stalls for longer than the lease lasts can lose it to other work.
 * It is told so through an AbortSignal and is expected to stop at its next
 * safe point (between requests), so two never read at once for long.
 */

/** A lease not renewed for this long is taken to belong to a program that died. */
export const YOUTUBE_LEASE_TTL_MS = 2 * 60 * 1000;
/** How often running work renews its lease; several renewals fit in the time above. */
export const YOUTUBE_LEASE_RENEW_MS = 30 * 1000;

export const READING_ELSEWHERE =
  'Shorts finder is already reading YouTube in another process. Wait for it to finish, then try again.';

/** Thrown, before any work starts, when the lease is held by other work. */
export class ReadingElsewhereError extends Error {
  constructor() {
    super(READING_ELSEWHERE);
    this.name = 'ReadingElsewhereError';
  }
}

export interface LeaseDeps {
  readonly leases: LeaseRepo;
  readonly now: () => Date;
  /** A name for one piece of work, unlike any other; used by tests. */
  readonly newOwner?: () => string;
  /** Replace the clock that renews the lease; used by tests. */
  readonly every?: (run: () => void, ms: number) => unknown;
  readonly stop?: (handle: unknown) => void;
}

const defaultEvery = (run: () => void, ms: number): unknown => {
  const handle = setInterval(run, ms);
  // Renewing a lease must not keep the program alive once its work is done.
  handle.unref();
  return handle;
};

const defaultStop = (handle: unknown): void => {
  clearInterval(handle as ReturnType<typeof setInterval>);
};

/**
 * Runs work that reads YouTube while holding the lease, and gives the lease
 * back when the work ends, however it ends. Rejects with a
 * ReadingElsewhereError, without starting the work, when other work holds it:
 * in another program or in this one. The signal given to the work is aborted
 * when a renewal finds the lease gone.
 */
export async function withYouTubeLease<T>(
  deps: LeaseDeps,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const owner = (deps.newOwner ?? randomUUID)();
  const expiry = (): Date => new Date(deps.now().getTime() + YOUTUBE_LEASE_TTL_MS);
  if (!deps.leases.acquire(owner, deps.now(), expiry())) throw new ReadingElsewhereError();

  const lost = new AbortController();
  const renew = (): void => {
    try {
      if (!deps.leases.renew(owner, expiry())) lost.abort();
    } catch {
      // The store was busy for a moment. The next beat renews it; if none
      // does, the lease runs out, which is what it is for.
    }
  };
  const beat = (deps.every ?? defaultEvery)(renew, YOUTUBE_LEASE_RENEW_MS);
  try {
    return await work(lost.signal);
  } finally {
    (deps.stop ?? defaultStop)(beat);
    try {
      deps.leases.release(owner);
    } catch {
      // The store was closed under the work. The lease runs out by itself, and
      // the work's own outcome is what the caller should hear about.
    }
  }
}

/**
 * Why a cycle stopped before its work was done, when the reason is one to
 * stop for quietly rather than a failure: there is nothing wrong with the
 * work, only no more of it can be done now.
 */
import { AllowanceSpentError, type QuotaLedger } from './quota/ledger';
import { YouTubeApiError } from './youtube/client';

/**
 * - `allowance`: the day's plan, or Google's own count, has no units left for this.
 * - `rate_limit`: Google said requests are coming too fast; wait a while.
 * - `lease_lost`: other work took over the right to read YouTube.
 * - `shutdown`: the service is stopping and asked running work to wind down.
 */
export type StopReason = 'allowance' | 'rate_limit' | 'lease_lost' | 'shutdown';

/** What the scheduler aborts running work with when the service is stopping. */
export const SHUTDOWN = 'shutdown';

/**
 * Why work was told to stop, asked between requests: null while it may carry
 * on. The signal is the lease's (lost to other work) joined with the
 * service's own (stopping).
 */
export function abortReason(signal: AbortSignal | undefined): StopReason | null {
  if (signal?.aborted !== true) return null;
  return signal.reason === SHUTDOWN ? 'shutdown' : 'lease_lost';
}

/**
 * What an error means for the cycle that met it: a reason to stop cleanly, or
 * null for a real failure. When Google itself says the day's allowance is
 * gone, the ledger is told, so nothing else spends against it today.
 */
export function stopReasonFor(
  error: unknown,
  ledger: Pick<QuotaLedger, 'markExhausted'>,
): StopReason | null {
  if (error instanceof AllowanceSpentError) return 'allowance';
  if (!(error instanceof YouTubeApiError)) return null;
  if (error.quotaSpent) {
    ledger.markExhausted();
    return 'allowance';
  }
  return error.rateLimited ? 'rate_limit' : null;
}

/** A failure in words fit for a report: the message, never a stack. */
export const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

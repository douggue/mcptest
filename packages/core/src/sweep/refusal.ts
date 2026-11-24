/**
 * Telling a refusal from a passing failure. When YouTube answers with a
 * sign-in wall, a "confirm you're not a bot" page or a 403/429 that outlasted
 * the pace limiter's usual retries, a sweep stops for the day. It does not
 * try another route, another address or a puzzle: it stops.
 */
const REFUSAL_STATUSES: ReadonlySet<number> = new Set([403, 429]);
const REFUSAL_TEXT =
  /sign in to confirm|not a bot|unusual traffic|LOGIN_REQUIRED|google\.[a-z.]+\/sorry|consent\.youtube\.com|accounts\.google\.com|\bstatus(?:\s+code)?\s*:?\s*(?:403|429)\b|too many requests/i;
const MAX_CAUSES = 5;

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as Record<string, unknown>;
  const status = record['status'] ?? record['statusCode'];
  return typeof status === 'number' ? status : null;
}

function chainOf(error: unknown): readonly unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < MAX_CAUSES) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

/** True when the failure, or a cause under it, is YouTube saying no. */
export function isRefusal(error: unknown): boolean {
  return chainOf(error).some((link) => {
    const status = statusOf(link);
    if (status !== null && REFUSAL_STATUSES.has(status)) return true;
    return REFUSAL_TEXT.test(link instanceof Error ? link.message : String(link));
  });
}

export const REFUSED_MESSAGE =
  'YouTube refused the reading (it asked to sign in, or said there was too much traffic from this address). The sweep stopped for today; nothing was tried another way.';

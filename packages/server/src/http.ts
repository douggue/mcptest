/** What every route shares: the reply envelope and the checks a request must pass. */

const MAX_BODY_CHARACTERS = 2000;

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null, meta: null }), {
    status,
    headers: HEADERS,
  });
}

export function fail(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error, meta: null }), {
    status,
    headers: HEADERS,
  });
}

/**
 * The server only answers to its own address. A page on another site can point
 * its domain at 127.0.0.1 (DNS rebinding) and would then look same-origin to
 * the browser, but its requests still carry that site's name in Host.
 */
export function isTrustedHost(request: Request, allowedHosts: readonly string[]): boolean {
  return allowedHosts.includes(request.headers.get('host') ?? '');
}

/**
 * A browser sends an Origin header on cross-site POSTs. Refusing any origin
 * that is not this server stops another website from changing anything here.
 */
export function isCrossSite(request: Request, allowedHosts: readonly string[]): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  try {
    return !allowedHosts.includes(new URL(origin).host);
  } catch {
    return true;
  }
}

/** Reads the JSON body of a write request, or returns the response that refuses it. */
export async function readJson(
  allowedHosts: readonly string[],
  request: Request,
): Promise<unknown | Response> {
  if (isCrossSite(request, allowedHosts)) {
    return fail(403, 'Requests from other sites are not accepted');
  }
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) {
    return fail(415, 'Send the request as application/json');
  }
  const text = await request.text();
  if (text.length > MAX_BODY_CHARACTERS) return fail(400, 'The request is too large');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail(400, 'The request is not valid JSON');
  }
}

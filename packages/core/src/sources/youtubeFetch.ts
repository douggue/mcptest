import {
  ProxyAgent,
  Socks5ProxyAgent,
  fetch as proxiedFetch,
  type Dispatcher,
  type RequestInit as ProxiedInit,
} from 'undici';
import { hideProxySecret, youtubeProxyOf } from './youtubeProxy';

/**
 * Jgtube's one way to reach YouTube: its pages and InnerTube API, its
 * pictures, its caption tracks and its video files. With the owner's proxy
 * for YouTube set, every such request goes through it; without one, straight
 * to YouTube as before. Nothing else in Jgtube uses this: not the AI engines,
 * not the official Data API.
 *
 * The proxy is read at each request, so one saved from the settings screen is
 * used from the next request on. This changes only the road a request takes:
 * how many requests are made and how fast is the rate limiter's business and
 * is the same with or without a proxy.
 */

export type YouTubeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** One agent per address, kept while that address is in force, so connections to the proxy are reused. */
interface Kept {
  readonly proxy: string;
  readonly agent: Dispatcher;
}

const isSocks = (proxy: string): boolean => /^socks5:/i.test(proxy);

function agentFor(proxy: string): Dispatcher {
  return isSocks(proxy) ? new Socks5ProxyAgent(proxy) : new ProxyAgent(proxy);
}

/** A request's address and options, from a plain address or a `Request` the YouTube library made. */
async function partsOf(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<{ readonly url: string; readonly init: RequestInit }> {
  if (typeof input === 'string' || input instanceof URL)
    return { url: String(input), init: init ?? {} };
  const body =
    init?.body !== undefined || input.body === null ? init?.body : await input.arrayBuffer();
  return {
    url: input.url,
    init: {
      method: input.method,
      headers: input.headers,
      redirect: input.redirect,
      signal: input.signal,
      ...init,
      ...(body === undefined ? {} : { body }),
    },
  };
}

const reasonOf = (error: unknown): string => {
  const cause = error instanceof Error ? error.cause : undefined;
  const own = error instanceof Error ? error.message : String(error);
  const deeper = cause instanceof Error ? cause.message : '';
  return deeper && deeper !== own ? `${own}: ${deeper}` : own;
};

const codeOf = (error: unknown): string | undefined => {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = (cause as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
};

/**
 * A failure through the proxy, with the proxy's address and password taken
 * out. "fetch failed" stays at the front, as the rate limiter knows it.
 */
function proxyFailure(error: unknown, proxy: string): Error {
  if (error instanceof Error && error.name === 'TimeoutError') return error;
  if (error instanceof Error && error.name === 'AbortError') return error;
  const code = codeOf(error);
  return Object.assign(
    new Error(
      `fetch failed through the proxy for YouTube: ${hideProxySecret(reasonOf(error), proxy)}`,
    ),
    code === undefined ? {} : { code },
  );
}

/**
 * Makes the fetch YouTube is read with. `proxyOf` says which proxy is in
 * force at each request (null for none) and may throw, to refuse reading at
 * all; `direct` is how a request without a proxy is made.
 */
export function makeYouTubeFetch(
  proxyOf: () => string | null,
  direct: typeof fetch = (input, init) => globalThis.fetch(input, init),
): YouTubeFetch {
  let kept: Kept | null = null;
  const agent = (proxy: string): Dispatcher => {
    if (kept?.proxy === proxy) return kept.agent;
    const previous = kept;
    kept = { proxy, agent: agentFor(proxy) };
    // Requests still on the old address finish on it; the agent then closes.
    previous?.agent.close().catch(() => {});
    return kept.agent;
  };
  return async (input, init) => {
    const proxy = proxyOf();
    if (proxy === null) return direct(input, init);
    const parts = await partsOf(input, init);
    try {
      const response = await proxiedFetch(parts.url, {
        ...(parts.init as ProxiedInit),
        dispatcher: agent(proxy),
      });
      return response as unknown as Response;
    } catch (error) {
      throw proxyFailure(error, proxy);
    }
  };
}

/** The fetch every YouTube request in Jgtube goes through; it reads the proxy from the settings. */
export const youtubeFetch: YouTubeFetch = makeYouTubeFetch(() => youtubeProxyOf(process.env));

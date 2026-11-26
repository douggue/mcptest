/**
 * The answers to the slow reads, kept until the store changes, and the
 * store's version on every answer so the page can tell when what it holds
 * is old. Only reads that come from the store alone are kept: nothing that
 * says what is running, and nothing read from files or the network.
 */
import { READ_MAX_AGE_MS } from './readCache';

/** Sent with every answer: changes whenever the store or the settings have. */
export const DATA_VERSION_HEADER = 'x-jgtube-data';

/** The reads worth keeping: each takes from a tenth to a whole second on a large store. */
export const KEPT_READS: ReadonlySet<string> = new Set([
  '/api/maps',
  '/api/maps/latest',
  '/api/maps/latest/thumbnails',
  '/api/maps/latest/same-topic',
  '/api/niches',
  '/api/transfers',
  '/api/flow',
  '/api/lab/hooks',
  '/api/lab/formulas',
  '/api/lab/concepts',
  '/api/bank',
]);

const MAX_KEPT = 64;

/** Answers kept are those that say something stable: found, or not found. */
const KEPT_STATUSES: ReadonlySet<number> = new Set([200, 404]);

/** An answer as bytes, so each request gets a Response of its own. */
interface Bytes {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: ArrayBuffer;
}

interface Entry {
  readonly version: string;
  readonly at: number;
  /** Shared by identical requests that arrive while it is worked out. */
  readonly answer: Promise<Bytes>;
}

function responseOf(bytes: Bytes, version: string): Response {
  const headers = new Headers(bytes.headers.map(([name, value]) => [name, value]));
  headers.set(DATA_VERSION_HEADER, version);
  return new Response(bytes.body.slice(0), { status: bytes.status, headers });
}

function withVersion(response: Response, version: string): Response {
  const headers = new Headers(response.headers);
  headers.set(DATA_VERSION_HEADER, version);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const bytesOf = async (response: Response): Promise<Bytes> => ({
  status: response.status,
  headers: [...response.headers.entries()],
  body: await response.arrayBuffer(),
});

export type Handler = (request: Request) => Promise<Response>;

export interface KeptReadsOptions {
  /** Changes whenever the store does; see `storeVersion`. */
  readonly storeVersion: () => string;
  readonly now?: () => number;
  readonly maxAgeMs?: number;
  /** Names this run of the server; tests fix it. */
  readonly run?: () => string;
}

/**
 * Wraps the API so the kept reads are answered from memory while nothing has
 * changed, and identical reads asked at once are worked out once. Any write
 * through the API (a setting saved, say) also counts as a change, since not
 * everything it changes is in the store.
 */
export function keptReads(handler: Handler, options: KeptReadsOptions): Handler {
  const now = options.now ?? (() => Date.now());
  const maxAgeMs = options.maxAgeMs ?? READ_MAX_AGE_MS;
  let writes = 0;
  // Which run of the server this is: its versions start again from the beginning.
  const run = (options.run ?? (() => Date.now().toString(36)))();
  const version = (): string => `${run}:${options.storeVersion()}-${writes}`;
  const kept = new Map<string, Entry>();

  const keep = (key: string, entry: Entry): void => {
    kept.delete(key);
    kept.set(key, entry);
    if (kept.size <= MAX_KEPT) return;
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  };
  const forget = (key: string, entry: Entry): void => {
    if (kept.get(key) === entry) kept.delete(key);
  };

  const read = async (request: Request, key: string): Promise<Response> => {
    const asked = version();
    const found = kept.get(key);
    if (found && found.version === asked && now() - found.at < maxAgeMs) {
      return responseOf(await found.answer, version());
    }
    const entry: Entry = {
      version: asked,
      at: now(),
      answer: handler(request).then(bytesOf),
    };
    keep(key, entry);
    try {
      const bytes = await entry.answer;
      // An error is not kept, nor an answer worked out while the store changed.
      if (!KEPT_STATUSES.has(bytes.status) || version() !== asked) forget(key, entry);
      return responseOf(bytes, version());
    } catch (error) {
      forget(key, entry);
      throw error;
    }
  };

  return async (request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && KEPT_READS.has(url.pathname)) {
      return read(request, `${url.pathname}${url.search}`);
    }
    const response = await handler(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') writes += 1;
    return withVersion(response, version());
  };
}

/**
 * What the page has already read from the server, kept in memory while it is
 * still true. Two screens asking for the same thing at once share one
 * request; a slow read (a map, the thumbnail board, the transfer list) is
 * asked for once and kept until the store changes. The server sends its data
 * version with every answer: a new one means something was written (a refresh
 * finished, a map was made, a job stored its work), so everything kept is
 * dropped and read again when next asked for. A write from this page drops it
 * too.
 */

/** The header the server sends its data version in. */
export const DATA_VERSION_HEADER = 'x-jgtube-data';

/** The reads worth keeping, as the server keeps them too. */
const KEPT_READS: ReadonlySet<string> = new Set([
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

/** Answers found or not found are kept; failures never are. */
const KEPT_STATUSES: ReadonlySet<number> = new Set([200, 404]);

/** Ten minutes, as on the server: some answers count days from now. */
const MAX_AGE_MS = 10 * 60 * 1000;

export interface Answer {
  readonly status: number;
  /** The server's data version; null when it sent none. */
  readonly version: string | null;
}

interface Kept<T> {
  readonly version: string | null;
  readonly at: number;
  readonly answer: T;
}

export interface QueryCache {
  /** The answer to a read: kept, already on its way, or asked for now. */
  read<T extends Answer>(path: string, load: () => Promise<T>): Promise<T>;
  /** After a write: everything kept may be old. */
  wrote(): void;
  /** Notes the data version an answer came with; a new one drops everything kept. */
  saw(version: string | null): void;
}

const pathOf = (path: string): string => path.split('?')[0] ?? path;

/** A version is `run:counts`: which run of the server, then counts that only ever grow. */
function partsOf(version: string): { readonly run: string; readonly counts: readonly number[] } {
  const [run = '', counts = ''] = version.split(':');
  return { run, counts: (counts.match(/\d+/g) ?? []).map(Number) };
}

/**
 * Whether `seen` is from before `current`: an answer read before a write and
 * arriving after it, which must not be kept or taken for new. Versions of
 * another run of the server (it was restarted) are never older: they are new.
 */
export function isOlder(seen: string | null, current: string | null): boolean {
  if (seen === null || current === null || seen === current) return false;
  const was = partsOf(seen);
  const now = partsOf(current);
  if (was.run !== now.run || was.counts.length !== now.counts.length) return false;
  return was.counts.every((count, index) => count <= (now.counts[index] ?? 0));
}

export function createQueryCache(now: () => number = () => Date.now()): QueryCache {
  let version: string | null = null;
  const kept = new Map<string, Kept<unknown>>();
  const asked = new Map<string, Promise<unknown>>();

  const saw = (seen: string | null): void => {
    if (seen === null || seen === version) return;
    version = seen;
    kept.clear();
  };

  const fresh = (entry: Kept<unknown> | undefined): boolean =>
    entry !== undefined && entry.version === version && now() - entry.at < MAX_AGE_MS;

  return {
    read<T extends Answer>(path: string, load: () => Promise<T>): Promise<T> {
      const entry = kept.get(path);
      if (entry && fresh(entry)) return Promise.resolve(entry.answer as T);
      const waiting = asked.get(path);
      if (waiting) return waiting as Promise<T>;
      const request = load().then((answer) => {
        if (isOlder(answer.version, version)) return answer;
        saw(answer.version);
        if (KEPT_READS.has(pathOf(path)) && KEPT_STATUSES.has(answer.status)) {
          kept.set(path, { version: answer.version, at: now(), answer });
        }
        return answer;
      });
      asked.set(path, request);
      const done = (): void => {
        if (asked.get(path) === request) asked.delete(path);
      };
      request.then(done, done);
      return request;
    },
    wrote: () => kept.clear(),
    saw,
  };
}

/** The one cache the page's requests share. */
export const pageCache: QueryCache = createQueryCache();

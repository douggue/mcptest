import type { Engine } from '../src/app';

export const HOST = '127.0.0.1:4317';
export const CHANNEL_ID = 'UCHnyfMqiRRG1u-2MsSQLbXA';

const unused = (name: string) => (): never => {
  throw new Error(`${name} is not used in this test`);
};

/** An engine where every part a test does not replace fails loudly when reached. */
export function stubEngine(parts: Partial<Engine>): Engine {
  return {
    findSnapshot: unused('findSnapshot'),
    findThumbnailBoard: unused('findThumbnailBoard'),
    findSameTopic: unused('findSameTopic'),
    crawl: unused('crawl'),
    setCompetitorStatus: unused('setCompetitorStatus'),
    listNiches: unused('listNiches'),
    setNicheWatched: unused('setNicheWatched'),
    // Asked before any work that reads YouTube starts; no other program is reading unless a test says so.
    isReadingYouTube: () => false,
    canDiscover: unused('canDiscover'),
    discover: unused('discover'),
    refresh: unused('refresh'),
    refreshStatus: unused('refreshStatus'),
    analyse: unused('analyse'),
    ...parts,
  };
}

type App = (request: Request) => Promise<Response>;

export const get = (app: App, path: string, host = HOST) =>
  app(new Request(`http://${HOST}${path}`, { headers: { host } }));

export const post = (app: App, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app(
    new Request(`http://${HOST}${path}`, {
      method: 'POST',
      headers: { host: HOST, 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

/** The parts of the standard envelope a test reads. */
export interface Reply<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: string | null;
  readonly meta: null;
}

export const read = async <T>(response: Response): Promise<Reply<T>> =>
  (await response.json()) as Reply<T>;

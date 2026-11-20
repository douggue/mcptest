import {
  COMPETITOR_STATUSES,
  parseChannelRef,
  type CompetitorStatus,
  type CrawlProgress,
  type MapSnapshot,
  type NicheList,
  type ThumbnailBoard,
} from '@jgtube/core';
import { z } from 'zod';
import type { JobStore } from './jobs';

const MAX_BODY_CHARACTERS = 2000;
const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 3;
const MIN_CHANNELS_PER_MAP = 10;
const MAX_CHANNELS_PER_MAP = 600;
const CHANNEL_ID = /^UC[\w-]{22}$/;

export interface CrawlOutcome {
  readonly centerChannelId: string;
  readonly warnings: readonly string[];
}

export interface CrawlChoices {
  /** A channel the owner wants to be like; the map is measured against it. */
  readonly model?: string | undefined;
  /** The most channels the map may hold, centre included. */
  readonly maxChannels?: number | undefined;
}

/** What the API needs from the engine, so tests can stand in for it. */
export interface Engine {
  /** The latest stored map around a channel; reads the store only. */
  findSnapshot(channel: string): MapSnapshot | null;
  /** The thumbnails that worked around a channel, from its latest map; reads the store only. */
  findThumbnailBoard(channel: string): ThumbnailBoard | null;
  crawl(
    channel: string,
    depth: number,
    onProgress: (progress: CrawlProgress) => void,
    choices?: CrawlChoices,
  ): Promise<CrawlOutcome>;
  /**
   * Records the owner's say on a channel of the centre's latest map.
   * False when the channel is not on that map, or is the centre itself.
   */
  setCompetitorStatus(
    centerChannelId: string,
    channelId: string,
    status: CompetitorStatus,
  ): boolean;
  /** New or small channels in the store with a video that took off, and the watched ones; reads the store only. */
  listNiches(): NicheList;
  /** Marks a channel as a niche to watch, or unmarks it. False when it is not in the store. */
  setNicheWatched(channelId: string, watched: boolean): boolean;
}

export interface AppOptions {
  readonly engine: Engine;
  readonly jobs: JobStore<CrawlOutcome>;
  /** The only `host:port` values this server answers to, such as `127.0.0.1:4317`. */
  readonly allowedHosts: readonly string[];
}

const crawlRequest = z.object({
  channel: z.string().min(1).max(200),
  depth: z.number().int().min(1).max(MAX_DEPTH).optional(),
  model: z.string().min(1).max(200).optional(),
  maxChannels: z.number().int().min(MIN_CHANNELS_PER_MAP).max(MAX_CHANNELS_PER_MAP).optional(),
});

const competitorRequest = z.object({
  center: z.string().regex(CHANNEL_ID),
  channel: z.string().regex(CHANNEL_ID),
  status: z.enum(COMPETITOR_STATUSES),
});

const watchRequest = z.object({
  channel: z.string().regex(CHANNEL_ID),
  watched: z.boolean(),
});

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null, meta: null }), {
    status,
    headers: HEADERS,
  });
}

function fail(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error, meta: null }), {
    status,
    headers: HEADERS,
  });
}

/** Returns the reason a channel reference is unusable, or null when it is fine. */
function channelProblem(channel: string): string | null {
  try {
    parseChannelRef(channel);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Not a valid channel';
  }
}

/**
 * The server only answers to its own address. A page on another site can point
 * its domain at 127.0.0.1 (DNS rebinding) and would then look same-origin to
 * the browser, but its requests still carry that site's name in Host.
 */
function isTrustedHost(request: Request, allowedHosts: readonly string[]): boolean {
  return allowedHosts.includes(request.headers.get('host') ?? '');
}

/**
 * A browser sends an Origin header on cross-site POSTs. Refusing any origin
 * that is not this server stops another website from changing anything here.
 */
function isCrossSite(request: Request, allowedHosts: readonly string[]): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  try {
    return !allowedHosts.includes(new URL(origin).host);
  } catch {
    return true;
  }
}

/** Reads the JSON body of a write request, or returns the response that refuses it. */
async function readJson(options: AppOptions, request: Request): Promise<unknown | Response> {
  if (isCrossSite(request, options.allowedHosts)) {
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

/** Answers a read about a channel's latest map, once the channel reference is known to be usable. */
function readLatest<T>(url: URL, find: (channel: string) => T | null): Response {
  const channel = url.searchParams.get('channel') ?? '';
  const problem = channelProblem(channel);
  if (problem) return fail(400, problem);
  const found = find(channel);
  return found ? ok(found) : fail(404, 'No map has been made for this channel yet');
}

async function startCrawl(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options, request);
  if (body instanceof Response) return body;
  const parsed = crawlRequest.safeParse(body);
  if (!parsed.success) {
    return fail(
      400,
      `Give a channel and, optionally, a depth of 1 to ${MAX_DEPTH} and a size of ${MIN_CHANNELS_PER_MAP} to ${MAX_CHANNELS_PER_MAP} channels`,
    );
  }
  const { channel, depth = DEFAULT_DEPTH, model, maxChannels } = parsed.data;
  const problem = channelProblem(channel);
  if (problem) return fail(400, problem);
  const modelProblem = model === undefined ? null : channelProblem(model);
  if (modelProblem) return fail(400, `Model channel: ${modelProblem}`);

  const job = options.jobs.start((report) =>
    options.engine.crawl(channel, depth, report, { model, maxChannels }),
  );
  if (!job) return fail(409, 'A map is already being made. Wait for it to finish.');
  return ok({ jobId: job.id }, 202);
}

async function setCompetitor(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options, request);
  if (body instanceof Response) return body;
  const parsed = competitorRequest.safeParse(body);
  if (!parsed.success) {
    return fail(
      400,
      `Give the centre channel, the channel and a status: ${COMPETITOR_STATUSES.join(', ')}`,
    );
  }
  const { center, channel, status } = parsed.data;
  return options.engine.setCompetitorStatus(center, channel, status)
    ? ok({ center, channel, status })
    : fail(404, 'That channel is not on the latest map of this centre channel');
}

async function setWatched(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options, request);
  if (body instanceof Response) return body;
  const parsed = watchRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'Give the channel and watched');
  const { channel, watched } = parsed.data;
  return options.engine.setNicheWatched(channel, watched)
    ? ok({ channel, watched })
    : fail(404, 'That channel has not been read yet');
}

function jobStatus(options: AppOptions, id: string): Response {
  const job = options.jobs.get(id);
  return job ? ok(job) : fail(404, 'No such job');
}

/** The JSON API as a plain function from request to response. */
export function createApp(options: AppOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    if (!isTrustedHost(request, options.allowedHosts)) {
      return fail(403, 'This server only answers to its own address');
    }
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    if (pathname === '/api/maps/latest') {
      return method === 'GET'
        ? readLatest(url, (channel) => options.engine.findSnapshot(channel))
        : fail(405, 'Use GET');
    }
    if (pathname === '/api/maps/latest/thumbnails') {
      return method === 'GET'
        ? readLatest(url, (channel) => options.engine.findThumbnailBoard(channel))
        : fail(405, 'Use GET');
    }
    if (pathname === '/api/maps') {
      return method === 'POST' ? startCrawl(options, request) : fail(405, 'Use POST');
    }
    if (pathname === '/api/competitors') {
      return method === 'POST' ? setCompetitor(options, request) : fail(405, 'Use POST');
    }
    if (pathname === '/api/niches') {
      return method === 'GET' ? ok(options.engine.listNiches()) : fail(405, 'Use GET');
    }
    if (pathname === '/api/niches/watch') {
      return method === 'POST' ? setWatched(options, request) : fail(405, 'Use POST');
    }
    if (pathname.startsWith('/api/jobs/')) {
      const id = pathname.slice('/api/jobs/'.length);
      return method === 'GET' ? jobStatus(options, id) : fail(405, 'Use GET');
    }
    return fail(404, 'Not found');
  };
}

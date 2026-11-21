import { z } from 'zod';
import type { AppOptions } from './app';
import { fail, ok, readJson } from './http';

/**
 * The style lock the owner uses for their channel: read it, take it from a
 * stored breakdown, or stop using it. Writes pass the same Host, Origin and
 * JSON checks as every other write; channels are channel ids.
 */

export const STYLE_LOCK_PATH = '/api/style-lock';
export const STYLE_LOCK_STOP_PATH = '/api/style-lock/stop';

const CHANNEL_ID = /^UC[\w-]{22}$/;
const channel = z.string().regex(CHANNEL_ID);
const useRequest = z.object({ channel, from: channel });
const stopRequest = z.object({ channel });

function readLock(options: AppOptions, url: URL): Response {
  const parsed = channel.safeParse(url.searchParams.get('channel'));
  if (!parsed.success) return fail(400, 'Give the channel as a channel id');
  return ok({ lock: options.engine.findStyleLock(parsed.data) });
}

async function useLock(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = useRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'Give the channel and the channel to take the lock from');
  try {
    return ok({ lock: options.engine.useStyleLock(parsed.data.channel, parsed.data.from) });
  } catch (error) {
    return fail(404, error instanceof Error ? error.message : 'There is no style lock to use');
  }
}

async function stopLock(options: AppOptions, request: Request): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = stopRequest.safeParse(body);
  if (!parsed.success) return fail(400, 'Give the channel as a channel id');
  options.engine.stopStyleLock(parsed.data.channel);
  return ok({ stopped: true });
}

/** How many of each thing are stored for the channel on screen; 404 with no map. */
export function readFlow(options: AppOptions, url: URL): Response {
  const parsed = channel.safeParse(url.searchParams.get('channel'));
  if (!parsed.success) return fail(400, 'Give the channel as a channel id');
  const counts = options.engine.flowCounts(parsed.data);
  return counts ? ok(counts) : fail(404, 'No map has been made for this channel yet');
}

/** The answer to a request for one of the style lock's paths; null for any other path. */
export function styleLockRoute(
  options: AppOptions,
  request: Request,
  url: URL,
): Promise<Response> | Response | null {
  const { method } = request;
  if (url.pathname === STYLE_LOCK_PATH) {
    if (method === 'GET') return readLock(options, url);
    return method === 'POST' ? useLock(options, request) : fail(405, 'Use GET or POST');
  }
  if (url.pathname === STYLE_LOCK_STOP_PATH) {
    return method === 'POST' ? stopLock(options, request) : fail(405, 'Use POST');
  }
  return null;
}

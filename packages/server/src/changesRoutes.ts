/**
 * The routes of "what changed since you last looked": a read for one channel
 * and a moment, and the write that moves the last look forward.
 */
import { SINCE_KINDS, type SinceKind } from '@jgtube/core';
import { z } from 'zod';
import { fail, ok } from './http';
import { CHANNEL_ID, NO_MAP, bodyOf, channelOf, type Context, type Routes } from './labHttp';

const SINCE_RULE = `Give since as one of: ${SINCE_KINDS.join(', ')}`;
const seenRequest = z.object({ channel: z.string().regex(CHANNEL_ID) });

const isSinceKind = (text: string): text is SinceKind => SINCE_KINDS.some((kind) => kind === text);

function readChanges(context: Context, url: URL): Response {
  const channel = channelOf(url);
  if (channel instanceof Response) return channel;
  const since = url.searchParams.get('since') ?? 'last-look';
  if (!isSinceKind(since)) return fail(400, SINCE_RULE);
  const found = context.options.engine.extras.findChanges(channel, since);
  return found ? ok(found) : fail(404, NO_MAP);
}

async function markSeen(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, seenRequest, 'Give the channel as a channel id');
  if (body instanceof Response) return body;
  const lastLookAt = context.options.engine.extras.markChangesSeen(body.channel);
  return lastLookAt === null ? fail(404, NO_MAP) : ok({ lastLookAt });
}

export const CHANGES_ROUTES: Routes = {
  '/api/changes': { GET: (context, _request, url) => readChanges(context, url) },
  '/api/changes/seen': { POST: markSeen },
};

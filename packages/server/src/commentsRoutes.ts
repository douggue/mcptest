/**
 * The routes of comment mining: what is known for a channel, reading the
 * chosen winners' comments with the owner's key, and asking "What viewers
 * ask for". Both long parts run as jobs.
 */
import { COMMENT_MINING_MAX_VIDEOS } from '@jgtube/core';
import { z } from 'zod';
import { ENGINE_IDS } from './engines/settings';
import {
  startExtrasAiJob,
  startExtrasJob,
  type ExtrasContext,
  type ExtrasRouteTable,
} from './extrasJobs';
import { fail, ok } from './http';
import { channelLabel } from './jobLabels';
import { CHANNEL_ID, NO_MAP, VIDEO_ID, bodyOf, channelOf } from './labHttp';

const NO_KEY =
  'No YouTube API key is set. Reading comments needs the official API: put a key in Settings.';
const videosRequest = z.object({
  channel: z.string().regex(CHANNEL_ID),
  videoIds: z.array(z.string().regex(VIDEO_ID)).min(1).max(COMMENT_MINING_MAX_VIDEOS),
});
const askRequest = videosRequest.extend({ engine: z.enum(ENGINE_IDS).optional() });
const VIDEOS_RULE = `Give the channel id and from 1 to ${COMMENT_MINING_MAX_VIDEOS} video ids`;

function readComments(context: ExtrasContext, url: URL): Response {
  const channel = channelOf(url);
  if (channel instanceof Response) return channel;
  const view = context.options.engine.extras.findComments(channel);
  return view ? ok(view) : fail(404, NO_MAP);
}

async function startRead(context: ExtrasContext, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, videosRequest, VIDEOS_RULE);
  if (body instanceof Response) return body;
  const { extras } = context.options.engine;
  const view = extras.findComments(body.channel);
  if (!view) return fail(404, NO_MAP);
  if (!view.keySet) return fail(400, NO_KEY);
  return startExtrasJob(
    context,
    async (report) => {
      report({ text: `Reading the comments of ${body.videoIds.length} videos` });
      const outcomes = await extras.readComments(body.channel, body.videoIds, (done, total) =>
        report({ text: `Read ${done} of ${total} videos` }),
      );
      return { kind: 'comments-read', outcomes };
    },
    channelLabel(context.options.engine, 'comments-read', 'Reading the comments of', body.channel),
  );
}

async function startAsk(context: ExtrasContext, request: Request): Promise<Response> {
  const body = await bodyOf(
    context,
    request,
    askRequest,
    `${VIDEOS_RULE}, and an engine if you choose one`,
  );
  if (body instanceof Response) return body;
  const { extras } = context.options.engine;
  if (!extras.findComments(body.channel)) return fail(404, NO_MAP);
  return startExtrasAiJob(
    context,
    async (report) => {
      report({ text: 'Asking the AI what viewers ask for' });
      const outcome = await extras.askViewers(body.channel, body.videoIds, body.engine);
      return { kind: 'viewer-answer', outcome };
    },
    channelLabel(
      context.options.engine,
      'viewer-answer',
      'Asking what viewers want from',
      body.channel,
    ),
  );
}

export const COMMENTS_ROUTES: ExtrasRouteTable = {
  '/api/comments': { GET: (context, _request, url) => readComments(context, url) },
  '/api/comments/read': { POST: startRead },
  '/api/comments/ask': { POST: startAsk },
};

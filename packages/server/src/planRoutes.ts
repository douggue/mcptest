/**
 * The routes of "your own videos against the plan": a channel's plan, linking
 * a kept concept to the video it became, and undoing a link.
 */
import { z } from 'zod';
import { fail, ok } from './http';
import { cleanMessage } from './jobs';
import { CHANNEL_ID, NO_MAP, bodyOf, channelOf, type Context, type Routes } from './labHttp';
import type { PlanLinkOutcome } from './planTypes';

/** Longer than any YouTube link the owner could paste. */
const MAX_LINK_CHARS = 500;

const conceptRequest = z.object({
  channel: z.string().regex(CHANNEL_ID),
  conceptId: z.number().int().positive(),
});
const linkRequest = conceptRequest.extend({ link: z.string().min(1).max(MAX_LINK_CHARS) });

const REFUSED: Readonly<Record<Exclude<PlanLinkOutcome, 'linked'>, readonly [number, string]>> = {
  'bad-link': [400, 'Paste a link to one YouTube video, or its id.'],
  'other-channel': [400, 'That video is from another channel. Link a video of this channel.'],
  'not-found': [
    404,
    "That video was not found among this channel's videos, even after reading the channel again.",
  ],
  'not-stored': [
    404,
    "That video was not found among this channel's videos, even after reading the channel again.",
  ],
  'video-taken': [409, 'That video is already linked to another concept of this channel.'],
  'no-concept': [404, 'There is no kept concept with that number for this channel.'],
  'no-map': [404, NO_MAP],
};

function readPlan(context: Context, url: URL): Response {
  const channel = channelOf(url);
  if (channel instanceof Response) return channel;
  const plan = context.options.engine.extras.findPlan(channel);
  return plan ? ok(plan) : fail(404, NO_MAP);
}

async function link(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(
    context,
    request,
    linkRequest,
    'Give the channel id, the concept number and the video link',
  );
  if (body instanceof Response) return body;
  try {
    const reply = await context.options.engine.extras.linkPlanVideo(
      body.channel,
      body.conceptId,
      body.link,
    );
    if (reply.outcome === 'linked' && reply.plan) return ok(reply.plan);
    const [status, message] =
      reply.outcome === 'linked' ? REFUSED['not-found'] : REFUSED[reply.outcome];
    return fail(status, message);
  } catch (error) {
    return fail(502, `The channel could not be read from YouTube: ${cleanMessage(error)}`);
  }
}

async function unlink(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(
    context,
    request,
    conceptRequest,
    'Give the channel id and the concept number',
  );
  if (body instanceof Response) return body;
  const plan = context.options.engine.extras.unlinkPlanVideo(body.channel, body.conceptId);
  return plan ? ok(plan) : fail(404, NO_MAP);
}

export const PLAN_ROUTES: Routes = {
  '/api/plan': { GET: (context, _request, url) => readPlan(context, url) },
  '/api/plan/link': { POST: link },
  '/api/plan/unlink': { POST: unlink },
};

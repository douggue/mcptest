/**
 * The routes of the script writer's research: read a concept's fact sheet
 * and claims check, research the subject again, and check the next claims.
 * Both runs are AI runs and take the slot every AI run shares.
 */
import { z } from 'zod';
import { ENGINE_IDS } from './engines/settings';
import { fail, ok } from './http';
import { CHANNEL_ID, bodyOf, startAiJob, type Context, type Routes } from './labHttp';

const channel = z.string().regex(CHANNEL_ID);
const concept = z.number().int().positive();
const runRequest = z.object({ channel, concept, engine: z.enum(ENGINE_IDS).optional() });
const readQuery = z.object({ channel, concept: z.coerce.number().int().positive() });
const NOT_THIS_CHANNELS = 'That concept is not one of this channel’s concepts';

function readResearch(context: Context, url: URL): Response {
  const parsed = readQuery.safeParse({
    channel: url.searchParams.get('channel'),
    concept: url.searchParams.get('concept'),
  });
  if (!parsed.success) return fail(400, 'Give the channel and the concept');
  return ok(context.options.engine.findResearch(parsed.data.channel, parsed.data.concept));
}

async function start(
  context: Context,
  request: Request,
  kind: 'research' | 'claims',
): Promise<Response> {
  const body = await bodyOf(context, request, runRequest, 'Give the channel and the concept');
  if (body instanceof Response) return body;
  const { engine } = context.options;
  if (engine.findConcept(body.channel, body.concept) === null) return fail(404, NOT_THIS_CHANNELS);
  return startAiJob(context, (report) =>
    kind === 'research'
      ? engine.researchConcept(body.channel, body.concept, body.engine, report)
      : engine.checkClaims(body.channel, body.concept, body.engine, report),
  );
}

export const RESEARCH_ROUTES: Routes = {
  '/api/lab/research': {
    GET: (context, _request, url) => readResearch(context, url),
    POST: (context, request) => start(context, request, 'research'),
  },
  '/api/lab/claims': { POST: (context, request) => start(context, request, 'claims') },
};

/** The routes of the risk check before publishing: a channel's check, and asking for one. */
import { z } from 'zod';
import { ENGINE_IDS } from './engines/settings';
import { startExtrasAiJob, type ExtrasContext, type ExtrasRouteTable } from './extrasJobs';
import { fail, ok } from './http';
import { conceptLabel } from './jobLabels';
import { CHANNEL_ID, NO_MAP, bodyOf, channelOf } from './labHttp';

const WHOLE = /^[1-9]\d{0,8}$/;
const askRequest = z.object({
  channel: z.string().regex(CHANNEL_ID),
  conceptId: z.number().int().positive(),
  engine: z.enum(ENGINE_IDS).optional(),
});

function readRisk(context: ExtrasContext, url: URL): Response {
  const channel = channelOf(url);
  if (channel instanceof Response) return channel;
  const concept = url.searchParams.get('concept');
  if (concept !== null && !WHOLE.test(concept))
    return fail(400, 'Give the concept as a whole number');
  const view = context.options.engine.extras.findRisk(
    channel,
    concept === null ? null : Number(concept),
  );
  return view ? ok(view) : fail(404, NO_MAP);
}

async function startAsk(context: ExtrasContext, request: Request): Promise<Response> {
  const body = await bodyOf(
    context,
    request,
    askRequest,
    'Give the channel id, the concept number, and an engine if you choose one',
  );
  if (body instanceof Response) return body;
  const { extras } = context.options.engine;
  if (!extras.findRisk(body.channel, null)) return fail(404, NO_MAP);
  return startExtrasAiJob(
    context,
    async (report) => {
      report({ text: 'Asking the AI to check the script before publishing' });
      const outcome = await extras.askRisk(body.channel, body.conceptId, body.engine);
      return { kind: 'risk-check', outcome };
    },
    conceptLabel(
      context.options.engine,
      'risk-check',
      'Checking before publishing',
      body.channel,
      body.conceptId,
    ),
  );
}

export const RISK_ROUTES: ExtrasRouteTable = {
  '/api/risk': { GET: (context, _request, url) => readRisk(context, url) },
  '/api/risk/ask': { POST: startAsk },
};

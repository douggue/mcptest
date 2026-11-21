/**
 * The routes of a concept's thumbnail prompt: the stored prompts of a
 * channel's concepts, and a run that writes one. Checked like the rest of
 * the idea lab; the run is an AI run and takes the slot they all share.
 */
import { z } from 'zod';
import { ENGINE_IDS } from './engines/settings';
import { fail, ok } from './http';
import { conceptLabel } from './jobLabels';
import {
  CHANNEL_ID,
  NO_MAP,
  bodyOf,
  channelOf,
  startAiJob,
  type Context,
  type Routes,
} from './labHttp';

const writeRequest = z.object({
  channel: z.string().regex(CHANNEL_ID),
  concept: z.number().int().positive(),
  engine: z.enum(ENGINE_IDS).optional(),
});

function readThumbnails(context: Context, url: URL): Response {
  const asked = channelOf(url);
  if (asked instanceof Response) return asked;
  const thumbnails = context.options.engine.listConceptThumbnails(asked);
  return thumbnails ? ok({ thumbnails }) : fail(404, NO_MAP);
}

async function startThumbnail(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, writeRequest, 'Give the channel and the concept');
  if (body instanceof Response) return body;
  const { engine } = context.options;
  if (engine.findConcept(body.channel, body.concept) === null) {
    return fail(404, 'That concept is not one of this channel’s concepts');
  }
  return startAiJob(
    context,
    (report) => engine.writeConceptThumbnail(body.channel, body.concept, body.engine, report),
    conceptLabel(
      engine,
      'concept-thumbnail',
      'Writing a thumbnail for',
      body.channel,
      body.concept,
    ),
  );
}

export const CONCEPT_THUMBNAIL_ROUTES: Routes = {
  '/api/lab/concepts/thumbnails': { GET: (context, _request, url) => readThumbnails(context, url) },
  '/api/lab/concepts/thumbnail': { POST: startThumbnail },
};

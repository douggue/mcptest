/**
 * The script writer's routes: open a concept's script, save the owner's
 * changes, run a stage, and measure a voice. Checked like the idea lab's:
 * the Host, Origin and JSON checks, zod on every body, a channel always a
 * channel id. A stage is an AI run and takes the slot every AI run shares.
 */
import {
  MAX_HOOK_MODELS,
  MAX_SCRIPT_CHARS,
  MAX_TARGET_SECONDS,
  MAX_TARGET_WORDS,
  MIN_TARGET_SECONDS,
  MIN_TARGET_WORDS,
  SCRIPT_STATUSES,
} from '@jgtube/core';
import { z } from 'zod';
import { ENGINE_IDS } from './engines/settings';
import { fail, ok } from './http';
import { cleanMessage } from './jobs';
import {
  CHANNEL_ID,
  NO_MAP,
  VIDEO_ID,
  bodyOf,
  channelOf,
  startAiJob,
  startLabJob,
  type Context,
  type Routes,
} from './labHttp';
import { SCRIPT_STAGES } from './scriptTypes';
import { channelLabel, conceptLabel } from './jobLabels';

/** A save carries up to four texts of a script; this is room for all of them and the JSON around them. */
const MAX_SAVE_CHARACTERS = 4 * MAX_SCRIPT_CHARS + 20_000;
const MAX_WORDS_PER_MINUTE = 400;
const NOT_THIS_CHANNELS = 'That concept is not one of this channel’s concepts';

const channel = z.string().regex(CHANNEL_ID);
const concept = z.number().int().positive();
const text = z.string().max(MAX_SCRIPT_CHARS);

const openRequest = z.object({ channel, concept });
const saveRequest = z.object({
  channel,
  concept,
  changes: z
    .object({
      status: z.enum(SCRIPT_STATUSES),
      voiceChannelId: z.string().regex(CHANNEL_ID),
      wordsPerMinute: z.number().int().positive().max(MAX_WORDS_PER_MINUTE),
      targetSeconds: z.number().int().min(MIN_TARGET_SECONDS).max(MAX_TARGET_SECONDS),
      hookModels: z.array(z.string().regex(VIDEO_ID)).max(MAX_HOOK_MODELS),
      chosenHook: text,
      beats: text,
      draft: text,
      tightened: text,
    })
    .partial()
    .strict(),
});
const stageRequest = z.object({
  channel,
  concept,
  stage: z.enum(SCRIPT_STAGES),
  engine: z.enum(ENGINE_IDS).optional(),
});
const voiceRequest = z.object({ channel, voice: channel });
const lengthRequest = z.object({
  channel,
  concept,
  length: z.discriminatedUnion('typed', [
    z.object({
      typed: z.literal('minutes'),
      seconds: z.number().int().min(MIN_TARGET_SECONDS).max(MAX_TARGET_SECONDS),
    }),
    z.object({
      typed: z.literal('words'),
      words: z.number().int().min(MIN_TARGET_WORDS).max(MAX_TARGET_WORDS),
    }),
  ]),
});
const LENGTH_RULE = `Give the channel, the concept and a length: ${MIN_TARGET_SECONDS} seconds to 3 hours, or ${MIN_TARGET_WORDS} to ${MAX_TARGET_WORDS} words`;

/** A length the owner typed, in minutes or in words. */
async function setLength(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, lengthRequest, LENGTH_RULE);
  if (body instanceof Response) return body;
  try {
    const view = context.options.engine.setScriptLength(body.channel, body.concept, body.length);
    return view ? ok(view) : fail(404, NOT_THIS_CHANNELS);
  } catch (error) {
    return fail(400, cleanMessage(error));
  }
}

function readScript(context: Context, url: URL): Response {
  const asked = channelOf(url);
  if (asked instanceof Response) return asked;
  const conceptId = Number(url.searchParams.get('concept') ?? '');
  if (!Number.isSafeInteger(conceptId) || conceptId < 1) return fail(400, 'Give the concept');
  const view = context.options.engine.findScriptView(asked, conceptId);
  return view ? ok(view) : fail(404, NOT_THIS_CHANNELS);
}

async function openScript(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, openRequest, 'Give the channel and the concept');
  if (body instanceof Response) return body;
  const view = context.options.engine.openScript(body.channel, body.concept);
  return view ? ok(view) : fail(404, NOT_THIS_CHANNELS);
}

const SAVE_RULE =
  'Give the channel, the concept and the changes: a status, a voice, a rate, a length, hooks to model, or a text';

async function saveScript(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, saveRequest, SAVE_RULE, MAX_SAVE_CHARACTERS);
  if (body instanceof Response) return body;
  const { engine } = context.options;
  // zod's partial leaves absent keys as undefined; only what was sent is a change.
  const changes = Object.fromEntries(
    Object.entries(body.changes).filter(([, value]) => value !== undefined),
  );
  if (engine.findScriptView(body.channel, body.concept) === null) {
    return fail(404, NOT_THIS_CHANNELS);
  }
  try {
    const problem = engine.scriptChangeProblem(body.channel, body.concept, changes);
    if (problem) return fail(400, problem);
    const view = engine.saveScript(body.channel, body.concept, changes);
    return view ? ok(view) : fail(404, NOT_THIS_CHANNELS);
  } catch (error) {
    return fail(400, `The script was not saved: ${cleanMessage(error)}`);
  }
}

/** What each stage of the script writer is doing, before the concept's title. */
const STAGE_DOING: Readonly<Record<(typeof SCRIPT_STAGES)[number], string>> = {
  hooks: 'Writing hooks for',
  draft: 'Writing the script of',
  tighten: 'Tightening the script of',
  lengthen: 'Writing the short sections again of',
};

async function startStage(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(
    context,
    request,
    stageRequest,
    'Give the channel, the concept and the stage',
  );
  if (body instanceof Response) return body;
  const { engine } = context.options;
  const problem = engine.stageProblem(body.stage, body.channel, body.concept);
  if (problem) return fail(400, problem);
  return startAiJob(
    context,
    (report) => engine.runScriptStage(body.stage, body.channel, body.concept, body.engine, report),
    conceptLabel(
      engine,
      `script-${body.stage}`,
      STAGE_DOING[body.stage],
      body.channel,
      body.concept,
    ),
  );
}

function readVoice(context: Context, url: URL): Response {
  const asked = channelOf(url);
  if (asked instanceof Response) return asked;
  const voice = url.searchParams.get('voice') ?? '';
  if (!CHANNEL_ID.test(voice)) return fail(400, 'Give the voice as a channel id');
  const view = context.options.engine.voiceOf(asked, voice);
  return view ? ok(view) : fail(404, 'That channel is not on this channel’s map');
}

/** Reads captions from YouTube: not an AI run. */
async function startVoiceRead(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, voiceRequest, 'Give the channel and the voice');
  if (body instanceof Response) return body;
  const { engine } = context.options;
  if (engine.voiceOf(body.channel, body.voice) === null) return fail(404, NO_MAP);
  return startLabJob(
    context,
    (report) => engine.readVoice(body.channel, body.voice, report),
    channelLabel(engine, 'voice-read', 'Reading the voice of', body.voice),
  );
}

export const SCRIPT_ROUTES: Routes = {
  '/api/lab/scripts': {
    GET: (context, _request, url) => readScript(context, url),
    POST: saveScript,
  },
  '/api/lab/scripts/open': { POST: openScript },
  '/api/lab/scripts/stage': { POST: startStage },
  '/api/lab/scripts/length': { POST: setLength },
  '/api/lab/voice': { GET: (context, _request, url) => readVoice(context, url) },
  '/api/lab/voice/read': { POST: startVoiceRead },
};

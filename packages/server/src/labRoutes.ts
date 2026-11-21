/**
 * The idea lab's routes: concepts, where-else, title formulas and the hook
 * library. Every write passes the Host, Origin and JSON checks the other
 * routes use, every body is checked with zod, and a channel is always a
 * channel id. Work that takes minutes runs as a job read at `/api/jobs/:id`.
 * A run of an AI engine shares the one slot the analyses and the breakdown
 * use, so only one of them runs at a time.
 */
import { CONCEPT_LENGTHS, FORMULA_DEFAULT_WINDOW_DAYS, FORMULA_WINDOWS } from '@jgtube/core';
import { z } from 'zod';
import type { AnalysisTracker } from './analysisRoutes';
import type { AppOptions } from './app';
import { ENGINE_IDS } from './engines/settings';
import { fail, ok } from './http';
import { MAX_ANGLE_CHARS, angleProblem } from './ideaQuestions';
import { channelLabel, conceptLabel } from './jobLabels';
import { JobStore, type Job, type JobRecord } from './jobs';
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
import type { ConceptRequest, LabOutcome, LabProgress } from './labTypes';
import { CONCEPT_THUMBNAIL_ROUTES } from './conceptThumbRoutes';
import { RESEARCH_ROUTES } from './researchRoutes';
import { SCRIPT_ROUTES } from './scriptRoutes';

/** A transfer template's key is the words of a title; no title is this long. */
const MAX_KEY_LENGTH = 300;
export const MAX_INSPIRATION = 5;

const channel = z.string().regex(CHANNEL_ID);
const engine = z.enum(ENGINE_IDS).optional();
const itemId = z.number().int().positive();
const videoIds = (min: number) =>
  z
    .array(z.string().regex(VIDEO_ID))
    .min(min)
    .max(MAX_INSPIRATION)
    .refine((ids) => new Set(ids).size === ids.length);

const batchRequest = z.object({
  channel,
  inspiration: videoIds(1),
  hookModels: videoIds(0).optional(),
  format: z
    .discriminatedUnion('source', [
      z.object({ source: z.literal('transfer'), key: z.string().min(1).max(MAX_KEY_LENGTH) }),
      z.object({ source: z.literal('formula'), id: itemId }),
    ])
    .optional(),
  angle: z
    .string()
    .max(MAX_ANGLE_CHARS)
    .refine((text) => angleProblem(text) === null)
    .optional(),
  length: z.enum(CONCEPT_LENGTHS),
  formulasFrom: channel.optional(),
  engine,
});
const growRequest = z.object({ channel, concept: itemId, engine });
const keepRequest = z.object({ channel, concept: itemId, kept: z.boolean() });
const channelRequest = z.object({ channel });
const askRequest = z.object({ channel, engine });
const formulaRequest = z.object({
  channel,
  window: z.union([z.literal(FORMULA_WINDOWS[0]), z.literal(FORMULA_WINDOWS[1])]).optional(),
  engine,
});

const BATCH_RULE = `Give the channel, 1 to ${MAX_INSPIRATION} picked videos, a length (long or shorts) and, optionally, a format, an angle of one line of at most ${MAX_ANGLE_CHARS} characters and an engine`;

async function startBatch(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, batchRequest, BATCH_RULE);
  if (body instanceof Response) return body;
  const angle = body.angle?.trim() ?? '';
  const asked: ConceptRequest = {
    centerChannelId: body.channel,
    inspiration: body.inspiration,
    hookModels: body.hookModels ?? [],
    format: body.format ?? null,
    angle: angle === '' ? null : angle,
    length: body.length,
    only: body.engine,
    ...(body.formulasFrom === undefined ? {} : { formulasFrom: body.formulasFrom }),
  };
  const { engine: lab } = context.options;
  const problem = lab.conceptProblem(asked);
  if (problem) return fail(400, problem);
  return startAiJob(
    context,
    (report) => lab.makeConcepts(asked, report),
    channelLabel(lab, 'concepts', 'Writing concepts for', body.channel),
  );
}

async function startGrowth(
  context: Context,
  request: Request,
  kind: 'twist' | 'more',
): Promise<Response> {
  const body = await bodyOf(context, request, growRequest, 'Give the channel and the concept');
  if (body instanceof Response) return body;
  const { engine: lab } = context.options;
  if (lab.findConcept(body.channel, body.concept) === null) {
    return fail(404, 'That concept is not one of this channel’s concepts');
  }
  const doing = kind === 'twist' ? 'Twisting' : 'Writing more like';
  return startAiJob(
    context,
    (report) => lab.growConcept(kind, body.channel, body.concept, body.engine, report),
    conceptLabel(lab, kind, doing, body.channel, body.concept),
  );
}

async function keepConcept(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(
    context,
    request,
    keepRequest,
    'Give the channel, the concept and kept',
  );
  if (body instanceof Response) return body;
  return context.options.engine.setConceptKept(body.channel, body.concept, body.kept)
    ? ok({ concept: body.concept, kept: body.kept })
    : fail(404, 'That concept is not one of this channel’s concepts');
}

async function clearConcepts(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, channelRequest, 'Give the channel');
  if (body instanceof Response) return body;
  return ok({ removed: context.options.engine.clearConcepts(body.channel) });
}

async function startWhereElse(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, askRequest, 'Give the channel');
  if (body instanceof Response) return body;
  const { engine: lab } = context.options;
  if (lab.listConcepts(body.channel) === null) return fail(404, NO_MAP);
  return startAiJob(
    context,
    (report) => lab.whereElse(body.channel, body.engine, report),
    channelLabel(lab, 'where-else', 'Finding where else the ideas of', body.channel),
  );
}

function readConcepts(context: Context, url: URL): Response {
  const asked = channelOf(url);
  if (asked instanceof Response) return asked;
  const list = context.options.engine.listConcepts(asked);
  return list ? ok(list) : fail(404, NO_MAP);
}

const WINDOW_RULE = `Give the channel and a window of ${FORMULA_WINDOWS.join(' or ')} days`;

function readFormulas(context: Context, url: URL): Response {
  const asked = channelOf(url);
  if (asked instanceof Response) return asked;
  const text = url.searchParams.get('window');
  const days = text === null ? FORMULA_DEFAULT_WINDOW_DAYS : Number(text);
  if (!FORMULA_WINDOWS.some((window) => window === days)) return fail(400, WINDOW_RULE);
  const list = context.options.engine.listFormulas(asked, days);
  return list ? ok(list) : fail(404, NO_MAP);
}

async function startFormulas(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, formulaRequest, WINDOW_RULE);
  if (body instanceof Response) return body;
  const { engine: lab } = context.options;
  const days = body.window ?? FORMULA_DEFAULT_WINDOW_DAYS;
  if (lab.listFormulas(body.channel, days) === null) return fail(404, NO_MAP);
  return startAiJob(
    context,
    (report) => lab.findFormulas(body.channel, days, body.engine, report),
    channelLabel(lab, 'formulas', 'Finding the title formats of', body.channel),
  );
}

function readHooks(context: Context, url: URL): Response {
  const asked = channelOf(url);
  if (asked instanceof Response) return asked;
  const library = context.options.engine.hookLibrary(asked);
  return library ? ok(library) : fail(404, NO_MAP);
}

/** Reads captions from YouTube: not an AI run, so it takes the lab's slot and not the AI's. */
async function startHookBuild(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, channelRequest, 'Give the channel');
  if (body instanceof Response) return body;
  const { engine: lab } = context.options;
  if (lab.hookLibrary(body.channel) === null) return fail(404, NO_MAP);
  return startLabJob(
    context,
    (report) => lab.buildHookLibrary(body.channel, report),
    channelLabel(lab, 'hooks-build', 'Reading the hooks around', body.channel),
  );
}

async function startHookLabels(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, askRequest, 'Give the channel');
  if (body instanceof Response) return body;
  const { engine: lab } = context.options;
  if (lab.hookLibrary(body.channel) === null) return fail(404, NO_MAP);
  return startAiJob(
    context,
    (report) => lab.labelHooks(body.channel, body.engine, report),
    channelLabel(lab, 'hooks-label', 'Naming the hook styles around', body.channel),
  );
}

/** Each path of the lab with what answers a read of it and what answers a write to it. */
const ROUTES: Routes = {
  ...SCRIPT_ROUTES,
  ...CONCEPT_THUMBNAIL_ROUTES,
  ...RESEARCH_ROUTES,
  '/api/lab/concepts': {
    GET: (context, _request, url) => readConcepts(context, url),
    POST: startBatch,
  },
  '/api/lab/concepts/twist': { POST: (context, request) => startGrowth(context, request, 'twist') },
  '/api/lab/concepts/more': { POST: (context, request) => startGrowth(context, request, 'more') },
  '/api/lab/concepts/keep': { POST: keepConcept },
  '/api/lab/concepts/clear': { POST: clearConcepts },
  '/api/lab/where-else': { POST: startWhereElse },
  '/api/lab/formulas': {
    GET: (context, _request, url) => readFormulas(context, url),
    POST: startFormulas,
  },
  '/api/lab/hooks': { GET: (context, _request, url) => readHooks(context, url) },
  '/api/lab/hooks/build': { POST: startHookBuild },
  '/api/lab/hooks/label': { POST: startHookLabels },
};

export interface LabRoutes {
  /** The answer to a request for one of the lab's paths; null for any other path. */
  handle(request: Request, url: URL): Promise<Response> | null;
  /** One of the lab's jobs, for `/api/jobs/:id`. */
  job(id: string): Job<LabOutcome, LabProgress> | null;
  /** The lab's jobs, for `/api/jobs`. */
  listJobs(): readonly JobRecord[];
}

/** The idea lab's routes, with a job store of their own and the AI slot they share. */
export function labRoutes(options: AppOptions, tracker: AnalysisTracker): LabRoutes {
  const context: Context = { options, jobs: new JobStore(), tracker };
  return {
    handle(request, url) {
      const route = ROUTES[url.pathname];
      if (!route) return null;
      const handler =
        request.method === 'GET' ? route.GET : request.method === 'POST' ? route.POST : undefined;
      if (!handler) {
        const allowed = [route.GET ? 'GET' : '', route.POST ? 'POST' : ''].filter(Boolean);
        return Promise.resolve(fail(405, `Use ${allowed.join(' or ')}`));
      }
      return Promise.resolve(handler(context, request, url));
    },
    job: (id) => context.jobs.get(id),
    listJobs: () => context.jobs.list(),
  };
}

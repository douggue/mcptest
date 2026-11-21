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
import { fail, ok, readJson } from './http';
import { MAX_ANGLE_CHARS, angleProblem } from './ideaQuestions';
import { JobStore, type Job } from './jobs';
import type { ConceptRequest, LabOutcome, LabProgress, Report } from './labTypes';

export type LabJobs = JobStore<LabOutcome, LabProgress>;

const CHANNEL_ID = /^UC[\w-]{22}$/;
const VIDEO_ID = /^[\w-]{11}$/;
/** A transfer template's key is the words of a title; no title is this long. */
const MAX_KEY_LENGTH = 300;
export const MAX_INSPIRATION = 5;
const BUSY = 'An AI run is already under way. Wait for it to finish.';
const LAB_BUSY = 'The idea lab is already working on something. Wait for it to finish.';
const NO_MAP = 'No map has been made for this channel yet';

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

interface Context {
  readonly options: AppOptions;
  readonly jobs: LabJobs;
  readonly tracker: AnalysisTracker;
}

type Work = (report: Report) => Promise<LabOutcome>;

/** Starts a run of an AI engine as a job, in the slot every such run shares. */
function startAiJob(context: Context, work: Work): Response {
  const { jobs, tracker } = context;
  if (tracker.running) return fail(409, BUSY);
  if (jobs.isBusy()) return fail(409, LAB_BUSY);
  tracker.running = true;
  const job = jobs.start((report) =>
    work(report).finally(() => {
      tracker.running = false;
    }),
  );
  if (!job) {
    tracker.running = false;
    return fail(409, LAB_BUSY);
  }
  return ok({ jobId: job.id }, 202);
}

/** Reads and checks a JSON body, or answers with the refusal. */
async function bodyOf<T>(
  context: Context,
  request: Request,
  schema: z.ZodType<T>,
  rule: string,
): Promise<T | Response> {
  const body = await readJson(context.options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : fail(400, rule);
}

/** The channel a read names, or the refusal. */
function channelOf(url: URL): string | Response {
  const asked = url.searchParams.get('channel') ?? '';
  return CHANNEL_ID.test(asked) ? asked : fail(400, 'Give the channel as a channel id');
}

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
  };
  const { engine: lab } = context.options;
  const problem = lab.conceptProblem(asked);
  if (problem) return fail(400, problem);
  return startAiJob(context, (report) => lab.makeConcepts(asked, report));
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
  return startAiJob(context, (report) =>
    lab.growConcept(kind, body.channel, body.concept, body.engine, report),
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
  return startAiJob(context, (report) => lab.whereElse(body.channel, body.engine, report));
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
  return startAiJob(context, (report) => lab.findFormulas(body.channel, days, body.engine, report));
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
  const job = context.jobs.start((report) => lab.buildHookLibrary(body.channel, report));
  return job ? ok({ jobId: job.id }, 202) : fail(409, LAB_BUSY);
}

async function startHookLabels(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, askRequest, 'Give the channel');
  if (body instanceof Response) return body;
  const { engine: lab } = context.options;
  if (lab.hookLibrary(body.channel) === null) return fail(404, NO_MAP);
  return startAiJob(context, (report) => lab.labelHooks(body.channel, body.engine, report));
}

type Handler = (context: Context, request: Request, url: URL) => Response | Promise<Response>;

/** Each path of the lab with what answers a read of it and what answers a write to it. */
const ROUTES: Readonly<Record<string, { readonly GET?: Handler; readonly POST?: Handler }>> = {
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
  };
}

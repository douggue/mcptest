/**
 * The format builder's formats: list, make, change, copy to the next version,
 * remove, and "Suggest a mix" as a job in the one slot every AI run shares,
 * listed in Working so the page can follow it again. Every write passes the
 * Host, Origin and JSON checks the other routes use; every body is checked
 * with zod.
 */
import { INGREDIENT_LAYERS, MAX_FORMAT_NAME, MAX_FORMAT_NOTES, MAX_SLOT_NOTE } from '@jgtube/core';
import { z } from 'zod';
import type { AnalysisTracker } from './analysisRoutes';
import type { AppOptions } from './app';
import { ENGINE_IDS } from './engines/settings';
import type { FormatView, MixProgress } from './formatBuilderTypes';
import { fail, ok, readJson } from './http';
import { JobStore, type Job, type JobRecord } from './jobs';

export const FORMATS_PATH = '/api/format/formats';
export const MIX_JOB_KIND = 'format-mix';

const BUSY = 'An AI run is already under way. Wait for it to finish.';
const NOT_FOUND = 'There is no such format.';
const ID = z.number().int().positive();
const NAME = z.string().trim().min(1).max(MAX_FORMAT_NAME);
const SECONDS = z.number().int().nullable();
const SLOTS = z.partialRecord(
  z.enum(INGREDIENT_LAYERS),
  z.object({ ingredientId: ID, note: z.string().max(MAX_SLOT_NOTE) }),
);

const createRequest = z.object({ name: NAME, targetSeconds: SECONDS.default(null) });
const updateRequest = z.object({
  id: ID,
  name: NAME.optional(),
  targetSeconds: SECONDS.optional(),
  notes: z.string().max(MAX_FORMAT_NOTES).optional(),
  slots: SLOTS.optional(),
});
const idRequest = z.object({ id: ID });
const suggestRequest = z.object({
  id: ID,
  channel: z
    .string()
    .regex(/^UC[\w-]{22}$/)
    .nullable()
    .default(null),
  engine: z.enum(ENGINE_IDS).optional(),
});

type MixJobs = JobStore<FormatView, MixProgress>;

interface Context {
  readonly options: AppOptions;
  readonly tracker: AnalysisTracker;
  readonly jobs: MixJobs;
}

async function bodyOf<T>(context: Context, request: Request, schema: z.ZodType<T>, rule: string) {
  const body = await readJson(context.options.allowedHosts, request, 40_000);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : fail(400, rule);
}

const plain = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function create(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, createRequest, 'Give the format a name.');
  if (body instanceof Response) return body;
  try {
    return ok(
      context.options.engine.formatBuilder.createFormat(body.name, body.targetSeconds),
      201,
    );
  } catch (error) {
    return fail(400, plain(error));
  }
}

async function update(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(
    context,
    request,
    updateRequest,
    'Give the format’s number and the change.',
  );
  if (body instanceof Response) return body;
  const { id, ...change } = body;
  try {
    const changed = context.options.engine.formatBuilder.updateFormat(id, change);
    return changed === null ? fail(404, NOT_FOUND) : ok(changed);
  } catch (error) {
    return fail(400, plain(error));
  }
}

async function duplicate(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, idRequest, 'Give the format’s number.');
  if (body instanceof Response) return body;
  const copy = context.options.engine.formatBuilder.duplicateFormat(body.id);
  return copy === null ? fail(404, NOT_FOUND) : ok(copy, 201);
}

async function remove(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, idRequest, 'Give the format’s number.');
  if (body instanceof Response) return body;
  return context.options.engine.formatBuilder.removeFormat(body.id)
    ? ok({ id: body.id })
    : fail(404, NOT_FOUND);
}

async function suggest(context: Context, request: Request): Promise<Response> {
  const body = await bodyOf(context, request, suggestRequest, 'Give the format’s number.');
  if (body instanceof Response) return body;
  const builder = context.options.engine.formatBuilder;
  const name = builder.formatName(body.id);
  if (name === null) return fail(404, NOT_FOUND);
  const { tracker, jobs } = context;
  if (tracker.running || jobs.isBusy()) return fail(409, BUSY);
  tracker.running = true;
  const job = jobs.start(
    (report) =>
      builder.suggestMix(body.id, body.channel, body.engine, report).finally(() => {
        tracker.running = false;
      }),
    { kind: MIX_JOB_KIND, title: `Suggesting a mix for “${name}”`, channelId: body.channel },
  );
  return ok({ jobId: job?.id }, 202);
}

const POSTS: Readonly<Record<string, (context: Context, request: Request) => Promise<Response>>> = {
  [FORMATS_PATH]: create,
  [`${FORMATS_PATH}/update`]: update,
  [`${FORMATS_PATH}/duplicate`]: duplicate,
  [`${FORMATS_PATH}/remove`]: remove,
  [`${FORMATS_PATH}/suggest`]: suggest,
};

export interface FormatBuilderRoutes {
  handle(request: Request, url: URL): Promise<Response> | Response | null;
  listJobs(): readonly JobRecord[];
  job(id: string): Job<FormatView, MixProgress> | null;
}

export function formatBuilderRoutes(
  options: AppOptions,
  tracker: AnalysisTracker,
): FormatBuilderRoutes {
  const context: Context = { options, tracker, jobs: new JobStore() };
  return {
    handle(request, url) {
      const { pathname } = url;
      if (pathname === FORMATS_PATH && request.method === 'GET') {
        return ok({ formats: options.engine.formatBuilder.listFormats() });
      }
      const post = POSTS[pathname];
      if (!post) return null;
      if (request.method === 'POST') return post(context, request);
      return fail(405, pathname === FORMATS_PATH ? 'Use GET or POST' : 'Use POST');
    },
    listJobs: () => context.jobs.list(),
    job: (id) => context.jobs.get(id),
  };
}

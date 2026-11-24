/**
 * The outlier bank's routes. Reads look at the store only. "Find more
 * outliers" reads YouTube: it is refused while a map, a refresh, a keyword
 * search or a money check runs here or in another program, and it holds the
 * store's lease while it runs, which refuses them in turn. It is a job in its
 * own store, listed in Working, so the page can follow it again after a reload.
 */
import {
  BANK_DEFAULT_PAGE,
  BANK_FIND_DEFAULT_CHANNELS,
  BANK_FIND_MAX_CHANNELS,
  FindCapError,
  MAX_COLLECTION_NAME,
  collectionNameProblem,
  parseBankQuery,
  type FindProgress,
} from '@jgtube/core';
import { z } from 'zod';
import type { AppOptions } from './app';
import type { FindResult } from './bankTypes';
import { fail, ok, readJson } from './http';
import { JobStore, type JobRecord, type Job } from './jobs';

export const BANK_PATH = '/api/bank';
export const BANK_BUSY =
  'A map, a refresh, a keyword search or a money check is reading YouTube. Try again when it has finished.';
const FIND_BUSY = 'Jgtube is already finding more outliers. Wait for it to finish.';
const VIDEO_ID = /^[\w-]{11}$/;
const MAX_QUERY = 200;

type FindJobs = JobStore<FindResult, FindProgress>;

const findRequest = z.object({
  query: z.string().trim().min(1).max(MAX_QUERY),
  channels: z.number().int().min(1).max(BANK_FIND_MAX_CHANNELS),
});
const nameRequest = z.object({ name: z.string().max(MAX_COLLECTION_NAME * 2) });
const idRequest = z.object({ id: z.number().int().positive() });
const itemRequest = z.object({
  id: z.number().int().positive(),
  video: z.string().regex(VIDEO_ID),
});

async function body<T>(options: AppOptions, request: Request, schema: z.ZodType<T>, rule: string) {
  const raw = await readJson(options.allowedHosts, request);
  if (raw instanceof Response) return raw;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fail(400, rule);
}

const wholeOr = (text: string | null, fallback: number): number => {
  const value = Number(text);
  return text !== null && Number.isInteger(value) && value >= 0 ? value : fallback;
};

function look(options: AppOptions, url: URL): Response {
  const state = parseBankQuery(url.searchParams);
  const offset = wholeOr(url.searchParams.get('offset'), 0);
  const limit = wholeOr(url.searchParams.get('limit'), BANK_DEFAULT_PAGE);
  return ok(options.engine.bank.look(state, { offset, limit }));
}

/** One stored video by its id, for its own page; null when it is not stored. */
function oneVideo(options: AppOptions, url: URL): Response {
  const videoId = url.searchParams.get('video') ?? '';
  if (!VIDEO_ID.test(videoId)) return fail(400, 'Give the video’s 11-character id');
  return ok({ found: options.engine.bank.video(videoId) });
}

function running(jobs: FindJobs): string | null {
  return jobs.list().find((job) => job.status === 'running')?.id ?? null;
}

function findInfo(options: AppOptions, jobs: FindJobs, url: URL): Response {
  const channels = Math.min(
    BANK_FIND_MAX_CHANNELS,
    Math.max(1, wholeOr(url.searchParams.get('channels'), BANK_FIND_DEFAULT_CHANNELS)),
  );
  const last = jobs.list().at(-1) ?? null;
  return ok({
    ...options.engine.bank.findInfo(channels),
    jobId: running(jobs),
    lastJobId: last?.id ?? null,
  });
}

async function startFind(options: AppOptions, jobs: FindJobs, request: Request) {
  const asked = await body(
    options,
    request,
    findRequest,
    `Give a keyword or topic (1 to ${MAX_QUERY} characters) and 1 to ${BANK_FIND_MAX_CHANNELS} channels`,
  );
  if (asked instanceof Response) return asked;
  if (jobs.isBusy()) return fail(409, FIND_BUSY);
  if (options.jobs.isBusy() || options.engine.isReadingYouTube()) return fail(409, BANK_BUSY);
  const { plan, allowance } = options.engine.bank.findInfo(asked.channels);
  const spend = plan.via === 'api' ? plan.apiUnits : plan.requests;
  if (spend > allowance.left) return fail(429, new FindCapError(allowance, plan).message);
  const job = jobs.start(
    (report) =>
      options.engine.bank.findMore({ query: asked.query, maxChannels: asked.channels }, report),
    { kind: 'bank-find', title: `Finding outliers for “${asked.query.slice(0, 60)}”` },
  );
  return job ? ok({ jobId: job.id }, 202) : fail(409, FIND_BUSY);
}

async function collectionWrite(options: AppOptions, request: Request, action: string) {
  const { collections } = options.engine.bank;
  if (action === 'create') {
    const asked = await body(options, request, nameRequest, 'Give the collection a name');
    if (asked instanceof Response) return asked;
    const problem = collectionNameProblem(asked.name);
    if (problem) return fail(400, problem);
    return ok({ collection: collections.create(asked.name), collections: collections.list() });
  }
  if (action === 'delete') {
    const asked = await body(options, request, idRequest, 'Give the collection’s id');
    if (asked instanceof Response) return asked;
    return collections.remove(asked.id)
      ? ok({ collections: collections.list() })
      : fail(404, 'There is no such collection');
  }
  const asked = await body(
    options,
    request,
    itemRequest,
    'Give the collection’s id and a video id',
  );
  if (asked instanceof Response) return asked;
  if (action === 'add' && !collections.add(asked.id, asked.video)) {
    return fail(404, 'There is no such collection');
  }
  if (action === 'remove') collections.take(asked.id, asked.video);
  return ok({ collections: collections.list() });
}

function exportCollection(options: AppOptions, url: URL): Response {
  const id = Number(url.searchParams.get('id'));
  const as = url.searchParams.get('as');
  if (!Number.isInteger(id) || id <= 0 || (as !== 'csv' && as !== 'md')) {
    return fail(400, 'Give the collection’s id and as=csv or as=md');
  }
  const file = options.engine.bank.collections.exportAs(id, as);
  if (!file) return fail(404, 'There is no such collection');
  return new Response(file.text, {
    headers: {
      'content-type': `${file.type}; charset=utf-8`,
      'content-disposition': `attachment; filename="${file.filename}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

const WRITES = new Set(['create', 'delete', 'add', 'remove']);

export interface BankRoutes {
  /** The answer to a request for one of the bank's paths; null for any other path. */
  handle(request: Request, url: URL): Promise<Response> | null;
  listJobs(): readonly JobRecord[];
  job(id: string): Job<FindResult, FindProgress> | null;
}

export function bankRoutes(options: AppOptions): BankRoutes {
  const jobs: FindJobs = new JobStore();
  const routes: Readonly<
    Record<
      string,
      Partial<Record<'GET' | 'POST', (request: Request, url: URL) => Response | Promise<Response>>>
    >
  > = {
    [BANK_PATH]: { GET: (_request, url) => look(options, url) },
    [`${BANK_PATH}/video`]: { GET: (_request, url) => oneVideo(options, url) },
    [`${BANK_PATH}/find`]: {
      GET: (_request, url) => findInfo(options, jobs, url),
      POST: (request) => startFind(options, jobs, request),
    },
    [`${BANK_PATH}/collections`]: {
      GET: () => ok({ collections: options.engine.bank.collections.list() }),
    },
    [`${BANK_PATH}/collections/export`]: { GET: (_request, url) => exportCollection(options, url) },
    ...Object.fromEntries(
      [...WRITES].map((action) => [
        `${BANK_PATH}/collections/${action}`,
        { POST: (request: Request) => collectionWrite(options, request, action) },
      ]),
    ),
  };
  return {
    handle(request, url) {
      const route = routes[url.pathname];
      if (!route) return null;
      const handler =
        request.method === 'GET' ? route.GET : request.method === 'POST' ? route.POST : undefined;
      if (!handler) return Promise.resolve(fail(405, route.GET ? 'Use GET' : 'Use POST'));
      return Promise.resolve(handler(request, url));
    },
    listJobs: () => jobs.list(),
    job: (id) => jobs.get(id),
  };
}

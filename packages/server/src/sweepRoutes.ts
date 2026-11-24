/**
 * The niche watchlist's routes. Reads and the owner's changes touch the store
 * only. "Sweep now" reads YouTube: it is refused while a map, a refresh, a
 * find or a money check runs here or in another program, and holds the
 * store's lease while it runs, which refuses them in turn. It is a job in its
 * own store, listed in Working. The schedule's turn comes through the same
 * route, so the timer and the button share one path.
 */
import {
  SWEEP_MAX_KEYWORDS,
  budgetProblem,
  keywordProblem,
  scheduleProblem,
  type SweepProgress,
  type SweepResult,
} from '@jgtube/core';
import { z } from 'zod';
import type { AppOptions } from './app';
import { BANK_BUSY } from './bankRoutes';
import { fail, ok, readJson } from './http';
import { JobStore, type Job, type JobRecord } from './jobs';

export const SWEEP_PATH = '/api/niches/sweep';
const SWEEP_BUSY = 'Jgtube is already sweeping the watchlist. Wait for it to finish.';
const MAX_TYPED = 400;

type SweepJobs = JobStore<SweepResult, SweepProgress>;

const startRequest = z.object({ by: z.enum(['owner', 'schedule']).optional() });
const keywordRequest = z.union([
  z.object({ action: z.literal('add'), keyword: z.string().max(MAX_TYPED) }),
  z.object({ action: z.enum(['remove', 'pause', 'resume']), id: z.number().int().positive() }),
]);
const settingsRequest = z.object({
  everyDays: z.number().nullable(),
  pageBudget: z.number(),
});

async function body<T>(options: AppOptions, request: Request, schema: z.ZodType<T>, rule: string) {
  const raw = await readJson(options.allowedHosts, request);
  if (raw instanceof Response) return raw;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fail(400, rule);
}

function info(options: AppOptions, jobs: SweepJobs): Response {
  const running = jobs.list().find((job) => job.status === 'running')?.id ?? null;
  return ok({
    ...options.engine.sweep.info(),
    jobId: running,
    lastJobId: jobs.list().at(-1)?.id ?? null,
  });
}

async function start(options: AppOptions, jobs: SweepJobs, request: Request): Promise<Response> {
  const asked = await body(
    options,
    request,
    startRequest,
    'Give by: owner or schedule, or nothing',
  );
  if (asked instanceof Response) return asked;
  const { sweep } = options.engine;
  const by = asked.by ?? 'owner';
  // The schedule's turn: nothing to do is a plain answer, not a refusal.
  if (by === 'schedule' && !sweep.isDue()) return ok({ started: false });
  if (jobs.isBusy()) return fail(409, SWEEP_BUSY);
  if (options.jobs.isBusy() || options.engine.isReadingYouTube()) return fail(409, BANK_BUSY);
  const problem = sweep.startProblem();
  if (problem) {
    return by === 'schedule' ? ok({ started: false }) : fail(problem.status, problem.message);
  }
  const job = jobs.start((report) => sweep.sweep(by, report), {
    kind: 'niche-sweep',
    title: 'Sweeping the niche watchlist',
  });
  return job ? ok({ started: true, jobId: job.id }, 202) : fail(409, SWEEP_BUSY);
}

async function changeKeywords(options: AppOptions, jobs: SweepJobs, request: Request) {
  const asked = await body(
    options,
    request,
    keywordRequest,
    'Give action add with a keyword, or remove, pause or resume with an id',
  );
  if (asked instanceof Response) return asked;
  const { sweep } = options.engine;
  if (asked.action === 'add') {
    const problem = keywordProblem(asked.keyword);
    if (problem) return fail(400, problem);
    const outcome = sweep.addKeyword(asked.keyword);
    if (outcome === 'full') {
      return fail(409, `The watchlist holds ${SWEEP_MAX_KEYWORDS} keywords at most. Remove one.`);
    }
    if (outcome === 'kept') return fail(409, 'That keyword is on the watchlist already.');
    return info(options, jobs);
  }
  const changed =
    asked.action === 'remove'
      ? sweep.removeKeyword(asked.id)
      : sweep.setPaused(asked.id, asked.action === 'pause');
  return changed ? info(options, jobs) : fail(404, 'There is no such keyword on the watchlist');
}

async function saveSettings(options: AppOptions, jobs: SweepJobs, request: Request) {
  const asked = await body(
    options,
    request,
    settingsRequest,
    'Give everyDays (a number of days, or null for off) and pageBudget',
  );
  if (asked instanceof Response) return asked;
  const problem = scheduleProblem(asked.everyDays) ?? budgetProblem(asked.pageBudget);
  if (problem) return fail(400, problem);
  options.engine.sweep.saveSettings(asked);
  return info(options, jobs);
}

export interface SweepRoutes {
  /** The answer to a request for one of the sweep's paths; null for any other path. */
  handle(request: Request, url: URL): Promise<Response> | null;
  listJobs(): readonly JobRecord[];
  job(id: string): Job<SweepResult, SweepProgress> | null;
}

export function sweepRoutes(options: AppOptions): SweepRoutes {
  const jobs: SweepJobs = new JobStore();
  const posts: Readonly<Record<string, (request: Request) => Promise<Response>>> = {
    [SWEEP_PATH]: (request) => start(options, jobs, request),
    [`${SWEEP_PATH}/keywords`]: (request) => changeKeywords(options, jobs, request),
    [`${SWEEP_PATH}/settings`]: (request) => saveSettings(options, jobs, request),
  };
  return {
    handle(request, url) {
      const post = posts[url.pathname];
      if (!post) return null;
      if (request.method === 'POST') return post(request);
      if (request.method === 'GET' && url.pathname === SWEEP_PATH) {
        return Promise.resolve(info(options, jobs));
      }
      return Promise.resolve(
        fail(405, url.pathname === SWEEP_PATH ? 'Use GET or POST' : 'Use POST'),
      );
    },
    listJobs: () => jobs.list(),
    job: (id) => jobs.get(id),
  };
}

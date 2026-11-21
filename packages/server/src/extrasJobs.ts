/**
 * The later features' long work as jobs, read at `GET /api/extras/job?id=`.
 * They have a job store of their own, so the shared stores' outcome types
 * stay as they are; an AI run still takes the one slot every AI run shares.
 */
import type { MineOutcome } from '@jgtube/core';
import type { ViewerAskOutcome } from './commentsTypes';
import type { RiskAskOutcome } from './riskTypes';
import { fail, ok } from './http';
import type { JobStore } from './jobs';
import type { Context } from './labHttp';

export type ExtrasOutcome =
  | { readonly kind: 'comments-read'; readonly outcomes: readonly MineOutcome[] }
  | { readonly kind: 'viewer-answer'; readonly outcome: ViewerAskOutcome }
  | { readonly kind: 'risk-check'; readonly outcome: RiskAskOutcome };

export interface ExtrasProgress {
  readonly text: string;
}

export type ExtrasJobs = JobStore<ExtrasOutcome, ExtrasProgress>;

export interface ExtrasContext extends Context {
  readonly extraJobs: ExtrasJobs;
}

export type ExtrasHandler = (
  context: ExtrasContext,
  request: Request,
  url: URL,
) => Response | Promise<Response>;

export type ExtrasRouteTable = Readonly<
  Record<string, { readonly GET?: ExtrasHandler; readonly POST?: ExtrasHandler }>
>;

type Work = (report: (progress: ExtrasProgress) => void) => Promise<ExtrasOutcome>;

const AI_BUSY = 'An AI run is already under way. Wait for it to finish.';
const EXTRAS_BUSY = 'Jgtube is already reading or asking about comments. Wait for it to finish.';

/** Starts work that is not an AI run, such as reading from the official API. */
export function startExtrasJob(context: ExtrasContext, work: Work): Response {
  const job = context.extraJobs.start(work);
  return job ? ok({ jobId: job.id }, 202) : fail(409, EXTRAS_BUSY);
}

/** Starts an AI run as a job, in the slot every AI run shares. */
export function startExtrasAiJob(context: ExtrasContext, work: Work): Response {
  const { extraJobs, tracker } = context;
  if (tracker.running) return fail(409, AI_BUSY);
  if (extraJobs.isBusy()) return fail(409, EXTRAS_BUSY);
  tracker.running = true;
  const job = extraJobs.start((report) =>
    work(report).finally(() => {
      tracker.running = false;
    }),
  );
  if (!job) {
    tracker.running = false;
    return fail(409, EXTRAS_BUSY);
  }
  return ok({ jobId: job.id }, 202);
}

/** One of the later features' jobs. */
export function readExtrasJob(context: ExtrasContext, url: URL): Response {
  const id = url.searchParams.get('id');
  if (!id) return fail(400, 'Give the job as id');
  const job = context.extraJobs.get(id);
  return job ? ok(job) : fail(404, 'No such job');
}

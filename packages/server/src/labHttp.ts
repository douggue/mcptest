/**
 * What the idea lab's and the script writer's routes share: the checks every
 * write passes, the one slot an AI run takes, and the job store of the lab.
 */
import type { z } from 'zod';
import type { AnalysisTracker } from './analysisRoutes';
import type { AppOptions } from './app';
import { fail, ok, readJson } from './http';
import type { JobLabel, JobStore } from './jobs';
import type { LabOutcome, LabProgress, Report } from './labTypes';

export type LabJobs = JobStore<LabOutcome, LabProgress>;

export const CHANNEL_ID = /^UC[\w-]{22}$/;
export const VIDEO_ID = /^[\w-]{11}$/;
export const NO_MAP = 'No map has been made for this channel yet';
const BUSY = 'An AI run is already under way. Wait for it to finish.';
export const LAB_BUSY = 'The idea lab is already working on something. Wait for it to finish.';

export interface Context {
  readonly options: AppOptions;
  readonly jobs: LabJobs;
  readonly tracker: AnalysisTracker;
}

export type Handler = (
  context: Context,
  request: Request,
  url: URL,
) => Response | Promise<Response>;

/** A path with what answers a read of it and what answers a write to it. */
export type Routes = Readonly<Record<string, { readonly GET?: Handler; readonly POST?: Handler }>>;

type Work = (report: Report) => Promise<LabOutcome>;

/** Starts a run of an AI engine as a job, in the slot every such run shares. */
export function startAiJob(context: Context, work: Work, label: JobLabel): Response {
  const { jobs, tracker } = context;
  if (tracker.running) return fail(409, BUSY);
  if (jobs.isBusy()) return fail(409, LAB_BUSY);
  tracker.running = true;
  const job = jobs.start(
    (report) =>
      work(report).finally(() => {
        tracker.running = false;
      }),
    label,
  );
  if (!job) {
    tracker.running = false;
    return fail(409, LAB_BUSY);
  }
  return ok({ jobId: job.id }, 202);
}

/** Starts work that is not an AI run as a job: it takes the lab's slot and not the AI's. */
export function startLabJob(context: Context, work: Work, label: JobLabel): Response {
  const job = context.jobs.start(work, label);
  return job ? ok({ jobId: job.id }, 202) : fail(409, LAB_BUSY);
}

/** Reads and checks a JSON body, or answers with the refusal. */
export async function bodyOf<T>(
  context: Context,
  request: Request,
  schema: z.ZodType<T>,
  rule: string,
  maxCharacters?: number,
): Promise<T | Response> {
  const body = await readJson(context.options.allowedHosts, request, maxCharacters);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : fail(400, rule);
}

/** The channel a read names, or the refusal. */
export function channelOf(url: URL): string | Response {
  const asked = url.searchParams.get('channel') ?? '';
  return CHANNEL_ID.test(asked) ? asked : fail(400, 'Give the channel as a channel id');
}

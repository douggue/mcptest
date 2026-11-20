import { z } from 'zod';
import { BUSY, type AppOptions } from './app';
import { fail, ok, readJson } from './http';

/** The most channels one refresh asked for over the API may read; the engine's own limit. */
const MAX_CHANNELS = 500;

/** The job of the refresh under way, so the screen can pick it up after a reload. */
export interface RefreshTracker {
  jobId: string | null;
}

const refreshRequest = z.object({
  maxChannels: z.number().int().min(1).max(MAX_CHANNELS).optional(),
});

/** The id of the refresh still running, or null when none is. */
function runningJobId(options: AppOptions, tracker: RefreshTracker): string | null {
  if (tracker.jobId === null) return null;
  return options.jobs.get(tracker.jobId)?.status === 'running' ? tracker.jobId : null;
}

/** When the store was last refreshed, how much is due and whether a refresh is running now. */
export function refreshState(options: AppOptions, tracker: RefreshTracker): Response {
  const jobId = runningJobId(options, tracker);
  return ok({ ...options.engine.refreshStatus(), running: jobId !== null, jobId });
}

/**
 * Starts a refresh as a background job, the way a crawl starts. It shares the
 * crawls' job store, so it is refused while a map is being made and a map is
 * refused while it runs.
 */
export async function startRefresh(
  options: AppOptions,
  request: Request,
  tracker: RefreshTracker,
): Promise<Response> {
  const body = await readJson(options.allowedHosts, request);
  if (body instanceof Response) return body;
  const parsed = refreshRequest.safeParse(body);
  if (!parsed.success) {
    return fail(400, `Optionally give maxChannels, a whole number from 1 to ${MAX_CHANNELS}`);
  }
  const { maxChannels } = parsed.data;
  const job = options.jobs.start((report) => options.engine.refresh(report, maxChannels));
  if (!job) return fail(409, BUSY);
  tracker.jobId = job.id;
  return ok({ jobId: job.id }, 202);
}

import { ReadingElsewhereError, type LogoOutcome, type LogoProgress } from '@jgtube/core';
import { z } from 'zod';
import { fail, ok, readJson } from './http';
import { JobStore, type Job } from './jobs';
import type { LogoEngine } from './logoTypes';

/**
 * Filling in the logos of a map made before logos were stored: a small job in
 * the background, started by the page when it opens such a map. One runs at a
 * time. It never starts while a map, a refresh or a keyword search is reading
 * YouTube, and it steps aside the moment one of those is asked for.
 */

export const LOGOS_PATH = '/api/logos';
export const LOGOS_WAIT =
  'Logos are fetched once the map, refresh or search under way has finished.';

const logoRequest = z.object({ channel: z.string().min(1).max(200) });
const NOTHING_READ: LogoOutcome = { asked: 0, found: 0, failed: 0, stoppedEarly: true };

export interface LogoRouteOptions {
  readonly engine: LogoEngine;
  readonly allowedHosts: readonly string[];
  /** Whether work that reads YouTube is under way, here or in another program. */
  readonly isReading: () => boolean;
  /** Why a channel reference is unusable, or null when it is fine. */
  readonly channelProblem: (channel: string) => string | null;
}

export interface LogoRoutes {
  /** Starts a logo job for the channel's latest map, or says why there is none to start. */
  start(request: Request): Promise<Response>;
  job(id: string): Job<LogoOutcome, LogoProgress> | null;
  /**
   * Ends the job under way after the channel it is on, and waits for it. Work
   * that reads YouTube calls this before it checks whether it may start.
   */
  standDown(): Promise<void>;
}

interface Running {
  readonly jobId: string;
  readonly ended: Promise<void>;
}

export function logoRoutes(options: LogoRouteOptions): LogoRoutes {
  const jobs = new JobStore<LogoOutcome, LogoProgress>();
  let running: Running | null = null;
  let stopping = false;

  const begin = (channelIds: readonly string[]): string | null => {
    let finish: () => void = () => {};
    const ended = new Promise<void>((resolve) => {
      finish = resolve;
    });
    stopping = false;
    const job = jobs.start((report) =>
      options.engine
        .fetchLogos(channelIds, report, () => stopping)
        .catch((error: unknown) => {
          // Another program began reading YouTube first: nothing was read, and the page asks again.
          if (error instanceof ReadingElsewhereError) return NOTHING_READ;
          throw error;
        })
        .finally(() => {
          running = null;
          finish();
        }),
    );
    if (!job) return null;
    running = { jobId: job.id, ended };
    return job.id;
  };

  return {
    async start(request) {
      const body = await readJson(options.allowedHosts, request);
      if (body instanceof Response) return body;
      const parsed = logoRequest.safeParse(body);
      if (!parsed.success) return fail(400, 'Give the channel whose map needs its logos');
      const problem = options.channelProblem(parsed.data.channel);
      if (problem) return fail(400, problem);
      const missing = options.engine.missingLogos(parsed.data.channel);
      if (missing === null) return fail(404, 'No map has been made for this channel yet');
      if (missing.length === 0) return ok({ jobId: null, missing: 0 });
      if (running) return ok({ jobId: running.jobId, missing: missing.length });
      if (options.isReading()) return fail(409, LOGOS_WAIT);
      const jobId = begin(missing);
      return jobId === null ? fail(409, LOGOS_WAIT) : ok({ jobId, missing: missing.length }, 202);
    },

    job: (id) => jobs.get(id),

    async standDown() {
      if (!running) return;
      stopping = true;
      await running.ended;
    },
  };
}

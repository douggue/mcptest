import { randomUUID } from 'node:crypto';
import type { CrawlProgress } from '@jgtube/core';

const MAX_ERROR_LENGTH = 300;
const MAX_JOBS_KEPT = 20;
/** Error text can carry scraped strings; keep control characters out of it. */
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

export interface Job<T> {
  readonly id: string;
  readonly status: 'running' | 'done' | 'failed';
  readonly progress: CrawlProgress | null;
  readonly result: T | null;
  readonly error: string | null;
}

export type Work<T> = (report: (progress: CrawlProgress) => void) => Promise<T>;

/** Matches things that look like file paths, which have no business reaching the browser. */
const PATH_LIKE = /(?:[A-Za-z]:)?[\\/][^\s:"']*[\\/][^\s:"']*/g;

export function cleanMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(UNSAFE_CHARACTERS, ' ')
    .replace(PATH_LIKE, '<path>')
    .slice(0, MAX_ERROR_LENGTH);
}

/**
 * Holds the state of long-running crawls in memory so the browser can poll
 * them. One job runs at a time: a crawl is hundreds of requests to YouTube and
 * two at once would double the rate.
 */
export class JobStore<T> {
  private jobs: ReadonlyMap<string, Job<T>> = new Map();
  private runningId: string | null = null;

  constructor(private readonly nextId: () => string = randomUUID) {}

  /** Starts the work in the background. Returns null when another job is still running. */
  start(work: Work<T>): Job<T> | null {
    if (this.runningId !== null) return null;
    const id = this.nextId();
    const job: Job<T> = { id, status: 'running', progress: null, result: null, error: null };
    this.runningId = id;
    this.save(job);
    Promise.resolve()
      .then(() => work((progress) => this.update(id, { progress })))
      .then(
        (result) => this.update(id, { status: 'done', result }),
        (error: unknown) => this.update(id, { status: 'failed', error: cleanMessage(error) }),
      )
      .finally(() => {
        this.runningId = null;
      });
    return job;
  }

  get(id: string): Job<T> | null {
    return this.jobs.get(id) ?? null;
  }

  private update(id: string, changes: Partial<Job<T>>): void {
    const current = this.jobs.get(id);
    if (current) this.save({ ...current, ...changes });
  }

  private save(job: Job<T>): void {
    const kept = [...this.jobs].filter(([id]) => id !== job.id).slice(-(MAX_JOBS_KEPT - 1));
    this.jobs = new Map([...kept, [job.id, job]]);
  }
}

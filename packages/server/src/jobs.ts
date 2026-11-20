import { randomUUID } from 'node:crypto';
import type { CrawlProgress } from '@jgtube/core';

const MAX_ERROR_LENGTH = 300;
const MAX_JOBS_KEPT = 20;
/** Error text can carry scraped strings; keep control characters out of it. */
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

export interface Job<T, P = CrawlProgress> {
  readonly id: string;
  readonly status: 'running' | 'done' | 'failed';
  readonly progress: P | null;
  readonly result: T | null;
  readonly error: string | null;
}

export type Work<T, P = CrawlProgress> = (report: (progress: P) => void) => Promise<T>;

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
 * Holds the state of long-running work (crawls, refreshes) in memory so the
 * browser can poll it. One job runs at a time, whatever its kind: each is
 * hundreds of requests to YouTube and two at once would double the rate.
 * A keyword search, which its caller waits for, takes the same slot.
 * `T` is what a finished job leaves behind and `P` what it reports on the way.
 */
export class JobStore<T, P = CrawlProgress> {
  private jobs: ReadonlyMap<string, Job<T, P>> = new Map();
  /** Whether the one slot is taken, by a job or by work a caller is waiting on. */
  private busy = false;

  constructor(private readonly nextId: () => string = randomUUID) {}

  /** Whether the one slot is taken, so nothing new can start. */
  isBusy(): boolean {
    return this.busy;
  }

  /** Starts the work in the background. Returns null when another job is still running. */
  start(work: Work<T, P>): Job<T, P> | null {
    if (this.busy) return null;
    const id = this.nextId();
    const job: Job<T, P> = { id, status: 'running', progress: null, result: null, error: null };
    this.busy = true;
    this.save(job);
    Promise.resolve()
      .then(() => work((progress) => this.update(id, { progress })))
      .then(
        (result) => this.update(id, { status: 'done', result }),
        (error: unknown) => this.update(id, { status: 'failed', error: cleanMessage(error) }),
      )
      .finally(() => {
        this.busy = false;
      });
    return job;
  }

  /**
   * Runs work whose caller waits for the answer, in the same one slot the jobs
   * use, so it cannot run beside a job nor a job beside it. Returns null when
   * the slot is taken. Nothing is kept afterwards: the caller has the answer.
   */
  hold<R>(work: () => Promise<R>): Promise<R> | null {
    if (this.busy) return null;
    this.busy = true;
    return Promise.resolve()
      .then(work)
      .finally(() => {
        this.busy = false;
      });
  }

  get(id: string): Job<T, P> | null {
    return this.jobs.get(id) ?? null;
  }

  private update(id: string, changes: Partial<Job<T, P>>): void {
    const current = this.jobs.get(id);
    if (current) this.save({ ...current, ...changes });
  }

  private save(job: Job<T, P>): void {
    const kept = [...this.jobs].filter(([id]) => id !== job.id).slice(-(MAX_JOBS_KEPT - 1));
    this.jobs = new Map([...kept, [job.id, job]]);
  }
}

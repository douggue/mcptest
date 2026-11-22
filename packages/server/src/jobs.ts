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

/**
 * What a job is, in words the owner reads, and what it belongs to, so a list
 * of the work under way can name it and the page can find it again.
 */
export interface JobLabel {
  /** What sort of work it is, such as `claims` or `refresh`. */
  readonly kind: string;
  /** A plain line, such as "Checking claims for <concept>". */
  readonly title: string;
  readonly channelId?: string | null;
  readonly conceptId?: number | null;
  readonly videoId?: string | null;
  /** The AI engine the work is about, for a picture check. */
  readonly engine?: string | null;
}

/** A job as a list of the work shows it: no result, with its label and its times. */
export interface JobRecord<P = unknown> {
  readonly id: string;
  readonly status: Job<unknown>['status'];
  readonly progress: P | null;
  readonly error: string | null;
  readonly label: JobLabel | null;
  /** Milliseconds since the epoch. */
  readonly startedAt: number;
  readonly finishedAt: number | null;
}

interface Entry<T, P> {
  readonly job: Job<T, P>;
  readonly label: JobLabel | null;
  readonly startedAt: number;
  readonly finishedAt: number | null;
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
  private entries: ReadonlyMap<string, Entry<T, P>> = new Map();
  /** Whether the one slot is taken, by a job or by work a caller is waiting on. */
  private busy = false;

  constructor(
    private readonly nextId: () => string = randomUUID,
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether the one slot is taken, so nothing new can start. */
  isBusy(): boolean {
    return this.busy;
  }

  /**
   * Starts the work in the background, under a label that names it in the
   * list of work. Returns null when another job is still running.
   */
  start(work: Work<T, P>, label: JobLabel | null = null): Job<T, P> | null {
    if (this.busy) return null;
    const id = this.nextId();
    const job: Job<T, P> = { id, status: 'running', progress: null, result: null, error: null };
    this.busy = true;
    this.save({ job, label, startedAt: this.now(), finishedAt: null });
    Promise.resolve()
      .then(() => work((progress) => this.update(id, { progress })))
      .then(
        (result) => this.end(id, { status: 'done', result }),
        (error: unknown) => this.end(id, { status: 'failed', error: cleanMessage(error) }),
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
    return this.entries.get(id)?.job ?? null;
  }

  /** The jobs kept, the oldest first, without what they left behind. */
  list(): readonly JobRecord<P>[] {
    return [...this.entries.values()].map(({ job, label, startedAt, finishedAt }) => ({
      id: job.id,
      status: job.status,
      progress: job.progress,
      error: job.error,
      label,
      startedAt,
      finishedAt,
    }));
  }

  private update(id: string, changes: Partial<Job<T, P>>, finishedAt: number | null = null): void {
    const current = this.entries.get(id);
    if (!current) return;
    this.save({ ...current, job: { ...current.job, ...changes }, finishedAt });
  }

  private end(id: string, changes: Partial<Job<T, P>>): void {
    this.update(id, changes, this.now());
  }

  private save(entry: Entry<T, P>): void {
    const { id } = entry.job;
    const kept = [...this.entries].filter(([key]) => key !== id).slice(-(MAX_JOBS_KEPT - 1));
    this.entries = new Map([...kept, [id, entry]]);
  }
}

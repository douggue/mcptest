/**
 * The work under way and lately finished, across every job store, for
 * `GET /api/jobs`: what the page's "Working" list shows and how a view finds
 * a run of its own to follow again after the owner has been elsewhere.
 */
import { JobStore, type JobLabel, type JobRecord } from './jobs';

/** How long a finished job stays in the list. */
export const RECENT_MS = 30 * 60 * 1000;
const MAX_LISTED = 20;

/** One job as the page reads it. Times are ISO-8601 strings. */
export interface JobEntry {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly channelId: string | null;
  readonly conceptId: number | null;
  readonly videoId: string | null;
  readonly engine: string | null;
  readonly status: JobRecord['status'];
  /** The step it is on, in plain words; null before it has said. */
  readonly progress: string | null;
  readonly error: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

/** Where a list of jobs is read from: one store's `list`. */
export type JobSource = () => readonly JobRecord[];

/**
 * Runs an AI engine's answer is waited for by the request that asked, such
 * as an analysis or a picture check, kept here only so they can be listed.
 */
export type HeldRuns = JobStore<unknown, never>;

export const heldRuns = (): HeldRuns => new JobStore<unknown, never>();

/** Lists work a request waits for under a label; hands back the same work. */
export function holdRun<R>(
  held: HeldRuns | undefined,
  label: JobLabel,
  work: Promise<R>,
): Promise<R> {
  held?.start(() => work, label);
  return work;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

/** Any store's progress in a few plain words. */
export function progressText(progress: unknown): string | null {
  if (!isRecord(progress)) return null;
  const { text, done, total, channels } = progress;
  if (typeof text === 'string' && text !== '') return text;
  if (typeof done === 'number' && typeof total === 'number') return `${done} of ${total} done`;
  if (typeof channels === 'number') {
    return `${channels} ${channels === 1 ? 'channel' : 'channels'} found so far`;
  }
  return null;
}

const UNLABELLED: JobLabel = { kind: 'work', title: 'Working' };

const iso = (time: number | null): string | null =>
  time === null ? null : new Date(time).toISOString();

function entryOf(record: JobRecord): JobEntry {
  const label = record.label ?? UNLABELLED;
  return {
    id: record.id,
    kind: label.kind,
    title: label.title,
    channelId: label.channelId ?? null,
    conceptId: label.conceptId ?? null,
    videoId: label.videoId ?? null,
    engine: label.engine ?? null,
    status: record.status,
    progress: progressText(record.progress),
    error: record.error,
    startedAt: new Date(record.startedAt).toISOString(),
    finishedAt: iso(record.finishedAt),
  };
}

const isListed = (record: JobRecord, now: number): boolean =>
  record.status === 'running' ||
  (record.finishedAt !== null && now - record.finishedAt <= RECENT_MS);

/** Running first, then the most recently started. */
const order = (a: JobRecord, b: JobRecord): number =>
  Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt;

/** The jobs running and those finished in the last half hour, from every source. */
export function listJobs(sources: readonly JobSource[], now: number = Date.now()): JobEntry[] {
  return sources
    .flatMap((source) => source())
    .filter((record) => isListed(record, now))
    .sort(order)
    .slice(0, MAX_LISTED)
    .map(entryOf);
}

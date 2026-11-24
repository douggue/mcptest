/**
 * The work the local server is doing, read at `GET /api/jobs`: what the top
 * bar's "Working" list shows, and how a view finds a run of its own to follow
 * again after the owner has been elsewhere. The work itself runs on the
 * server; leaving a view only stops the page from watching it.
 */
import { apiCaller, type Fetch } from './api';
import { viewHref, type ViewId } from './routes';

export interface JobEntry {
  readonly id: string;
  /** What sort of work it is, such as `claims` or `refresh`. */
  readonly kind: string;
  readonly title: string;
  readonly channelId: string | null;
  readonly conceptId: number | null;
  readonly videoId: string | null;
  readonly engine: string | null;
  readonly status: 'running' | 'done' | 'failed';
  readonly progress: string | null;
  readonly error: string | null;
  /** ISO-8601. */
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

/** How often the list is read while something runs, and otherwise. */
export const BUSY_POLL_MS = 4000;
export const IDLE_POLL_MS = 30_000;

export function createJobsApi(fetcher?: Fetch) {
  const { call, unwrap } = apiCaller(fetcher);
  return {
    async list(): Promise<readonly JobEntry[]> {
      return unwrap<{ jobs: JobEntry[] }>(await call('/api/jobs')).jobs;
    },
  };
}

export type JobsApi = ReturnType<typeof createJobsApi>;

/** What a running job must belong to; a part left out matches anything. */
export interface JobTarget {
  readonly channelId?: string | null;
  readonly conceptId?: number | null;
  readonly videoId?: string | null;
  readonly engine?: string | null;
}

const matches = (wanted: unknown, actual: unknown): boolean =>
  wanted === undefined || wanted === actual;

/** The first running job of one of these kinds that belongs to the target. */
export function runningJobOf(
  jobs: readonly JobEntry[],
  kinds: readonly string[],
  target: JobTarget,
): JobEntry | null {
  return (
    jobs.find(
      (job) =>
        job.status === 'running' &&
        kinds.includes(job.kind) &&
        matches(target.channelId, job.channelId) &&
        matches(target.conceptId, job.conceptId) &&
        matches(target.videoId, job.videoId) &&
        matches(target.engine, job.engine),
    ) ?? null
  );
}

/** Asks the server for such a job; null when there is none or it cannot be asked. */
export async function findRunningJob(
  api: JobsApi,
  kinds: readonly string[],
  target: JobTarget,
): Promise<JobEntry | null> {
  try {
    return runningJobOf(await api.list(), kinds, target);
  } catch {
    return null;
  }
}

/** The view each kind of work is shown and followed in. */
const VIEW_OF: Readonly<Record<string, Exclude<ViewId, 'channel'>>> = {
  map: 'radar',
  logos: 'radar',
  refresh: 'what-changed',
  breakdown: 'breakdown',
  'video-breakdown': 'video-breakdown',
  analysis: 'ask',
  'picture-check': 'settings',
  concepts: 'ideas',
  twist: 'ideas',
  more: 'ideas',
  'where-else': 'ideas',
  'concept-thumbnail': 'ideas',
  formulas: 'formats',
  'hooks-build': 'hooks',
  'hooks-label': 'hooks',
  'script-hooks': 'script',
  'script-draft': 'script',
  'script-tighten': 'script',
  'script-lengthen': 'script',
  'voice-read': 'script',
  research: 'script',
  claims: 'script',
  'comments-read': 'comments',
  'viewer-answer': 'comments',
  'risk-check': 'risk',
  'thumbnail-review': 'thumbnails',
  'format-mix': 'format',
  'bank-find': 'outlier-bank',
  'format-bible': 'format',
};

export const viewOfJob = (job: JobEntry): ViewId | null => VIEW_OF[job.kind] ?? null;

/** The address of the view a job belongs to; null for work with no view of its own. */
export function jobHref(job: JobEntry): string | null {
  const view = VIEW_OF[job.kind];
  return view ? viewHref(view) : null;
}

/** How long a job has run, or ran, in a few words. */
export function elapsedText(job: JobEntry, now: number): string {
  const end = job.finishedAt === null ? now : Date.parse(job.finishedAt);
  const seconds = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Background work nobody pressed a button for, which the Working indicator leaves out. */
const QUIET_KINDS: ReadonlySet<string> = new Set(['logos']);

/** The jobs the owner asked for: quiet background work, such as reading logos, is left out. */
export const askedFor = (jobs: readonly JobEntry[]): readonly JobEntry[] =>
  jobs.filter((job) => !QUIET_KINDS.has(job.kind));

export const runningJobs = (jobs: readonly JobEntry[]): readonly JobEntry[] =>
  jobs.filter((job) => job.status === 'running');

export const pollDelay = (jobs: readonly JobEntry[]): number =>
  runningJobs(jobs).length > 0 ? BUSY_POLL_MS : IDLE_POLL_MS;

/**
 * The jobs seen running before that have finished since, while the owner was
 * on another view than theirs: each gets a quiet "Done" line.
 */
export function finishedElsewhere(
  seenRunning: ReadonlySet<string>,
  jobs: readonly JobEntry[],
  activeView: ViewId,
): readonly JobEntry[] {
  return jobs.filter(
    (job) => job.status !== 'running' && seenRunning.has(job.id) && viewOfJob(job) !== activeView,
  );
}

/** The "Done" line of a finished job. */
export const doneLine = (job: JobEntry): string =>
  job.status === 'done' ? `Done: ${job.title}` : `Stopped: ${job.title}`;

const MAX_NOTICES = 5;

/** What the top bar keeps between reads: the jobs it saw running, and its "Done" lines. */
export interface JobWatch {
  readonly seen: ReadonlySet<string>;
  readonly notices: readonly JobEntry[];
}

export const NO_WATCH: JobWatch = { seen: new Set(), notices: [] };

/**
 * After a read of the list: a job seen running that has finished while the
 * owner was on another view gains a "Done" line; a line whose view the owner
 * is on goes, since what it says is on screen.
 */
export function watchStep(watch: JobWatch, jobs: readonly JobEntry[], active: ViewId): JobWatch {
  const finished = finishedElsewhere(watch.seen, jobs, active);
  const fresh = new Set(finished.map(({ id }) => id));
  const kept = watch.notices.filter(({ id }) => !fresh.has(id));
  return {
    seen: new Set(runningJobs(jobs).map(({ id }) => id)),
    notices: [...finished, ...kept]
      .filter((job) => viewOfJob(job) !== active)
      .slice(0, MAX_NOTICES),
  };
}

/** The watch without one "Done" line, once the owner has dismissed or opened it. */
export const dismissNotice = (watch: JobWatch, id: string): JobWatch => ({
  ...watch,
  notices: watch.notices.filter((job) => job.id !== id),
});

import { describe, expect, test } from 'vitest';
import {
  BUSY_POLL_MS,
  IDLE_POLL_MS,
  createJobsApi,
  doneLine,
  elapsedText,
  findRunningJob,
  finishedElsewhere,
  jobHref,
  pollDelay,
  runningJobOf,
  runningJobs,
  viewOfJob,
  watchStep,
  dismissNotice,
  NO_WATCH,
  type JobEntry,
} from '../src/lib/jobs';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const START = Date.parse('2026-11-21T10:00:00.000Z');

const job = (parts: Partial<JobEntry>): JobEntry => ({
  id: 'j1',
  kind: 'risk-check',
  title: 'Checking before publishing “Bridges”',
  channelId: CHANNEL,
  conceptId: 7,
  videoId: null,
  engine: null,
  status: 'running',
  progress: null,
  error: null,
  startedAt: new Date(START).toISOString(),
  finishedAt: null,
  ...parts,
});

const reply = (status: number, data: unknown, error: string | null = null) =>
  new Response(JSON.stringify({ success: status < 400, data, error, meta: null }), { status });

describe('runningJobOf', () => {
  const jobs = [
    job({ id: 'done', status: 'done' }),
    job({ id: 'other', channelId: 'UCother' }),
    job({ id: 'risk' }),
    job({ id: 'thumb', kind: 'thumbnail-review', conceptId: null, videoId: 'abcdefghijk' }),
  ];

  test('finds the running job of a kind for the target', () => {
    expect(runningJobOf(jobs, ['risk-check'], { channelId: CHANNEL })?.id).toBe('risk');
    expect(runningJobOf(jobs, ['risk-check'], { channelId: CHANNEL, conceptId: 7 })?.id).toBe(
      'risk',
    );
    expect(runningJobOf(jobs, ['thumbnail-review'], { videoId: 'abcdefghijk' })?.id).toBe('thumb');
  });

  test('finds none for another target, kind or a finished job', () => {
    expect(runningJobOf(jobs, ['risk-check'], { channelId: CHANNEL, conceptId: 8 })).toBeNull();
    expect(runningJobOf(jobs, ['claims'], {})).toBeNull();
    expect(runningJobOf([job({ status: 'failed' })], ['risk-check'], {})).toBeNull();
  });
});

describe('createJobsApi and findRunningJob', () => {
  test('reads the list and finds the job', async () => {
    const asked: string[] = [];
    const api = createJobsApi(async (input) => {
      asked.push(input);
      return reply(200, { jobs: [job({})] });
    });

    expect(await api.list()).toHaveLength(1);
    expect((await findRunningJob(api, ['risk-check'], { channelId: CHANNEL }))?.id).toBe('j1');
    expect(asked).toEqual(['/api/jobs', '/api/jobs']);
  });

  test('finds nothing when the server cannot be asked', async () => {
    const api = createJobsApi(async () => reply(500, null, 'down'));

    await expect(api.list()).rejects.toThrow();
    expect(await findRunningJob(api, ['risk-check'], {})).toBeNull();
  });
});

describe('where a job is shown', () => {
  test('names the view of each kind, and none for an unknown one', () => {
    expect(viewOfJob(job({}))).toBe('risk');
    expect(jobHref(job({ kind: 'claims' }))).toBe('#/script');
    expect(jobHref(job({ kind: 'comments-read' }))).toBe('#/comments');
    expect(viewOfJob(job({ kind: 'work' }))).toBeNull();
    expect(jobHref(job({ kind: 'work' }))).toBeNull();
  });
});

describe('elapsedText', () => {
  test('says how long a job has run, or ran', () => {
    expect(elapsedText(job({}), START + 12_400)).toBe('12 s');
    expect(elapsedText(job({}), START + 3 * 60_000 + 5_000)).toBe('3 min');
    expect(elapsedText(job({}), START + 65 * 60_000)).toBe('1 h 5 min');
    expect(elapsedText(job({}), START - 5_000)).toBe('0 s');
    const finished = job({ finishedAt: new Date(START + 90_000).toISOString() });
    expect(elapsedText(finished, START + 10 * 60_000)).toBe('1 min');
  });
});

describe('polling and finished work', () => {
  test('polls often only while something runs', () => {
    expect(pollDelay([job({})])).toBe(BUSY_POLL_MS);
    expect(pollDelay([job({ status: 'done' })])).toBe(IDLE_POLL_MS);
    expect(runningJobs([job({}), job({ id: 'b', status: 'done' })])).toHaveLength(1);
  });

  test('lists jobs seen running that finished while the owner was on another view', () => {
    const jobs = [
      job({ id: 'a', status: 'done' }),
      job({ id: 'b', status: 'failed', kind: 'claims' }),
      job({ id: 'c', status: 'done', kind: 'claims' }),
      job({ id: 'd' }),
    ];
    const seen = new Set(['a', 'b', 'd']);

    expect(finishedElsewhere(seen, jobs, 'risk').map(({ id }) => id)).toEqual(['b']);
    expect(finishedElsewhere(seen, jobs, 'home').map(({ id }) => id)).toEqual(['a', 'b']);
  });

  test('words the line of a finished job', () => {
    expect(doneLine(job({ status: 'done', title: 'Reviewing a thumbnail' }))).toBe(
      'Done: Reviewing a thumbnail',
    );
    expect(doneLine(job({ status: 'failed', title: 'Reviewing a thumbnail' }))).toBe(
      'Stopped: Reviewing a thumbnail',
    );
  });
});

describe('watchStep', () => {
  test('adds a Done line for work that finished elsewhere and keeps it until its view opens', () => {
    const running = [job({ id: 'a' }), job({ id: 'b', kind: 'claims' })];
    const first = watchStep(NO_WATCH, running, 'home');
    expect([...first.seen]).toEqual(['a', 'b']);
    expect(first.notices).toEqual([]);

    const finished = [job({ id: 'a', status: 'done' }), job({ id: 'b', kind: 'claims' })];
    const second = watchStep(first, finished, 'home');
    expect(second.notices.map(({ id }) => id)).toEqual(['a']);
    expect([...second.seen]).toEqual(['b']);

    expect(watchStep(second, finished, 'home').notices.map(({ id }) => id)).toEqual(['a']);
    expect(watchStep(second, finished, 'risk').notices).toEqual([]);
    expect(dismissNotice(second, 'a').notices).toEqual([]);
  });

  test('keeps only the latest few lines', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const seen = watchStep(
      NO_WATCH,
      ids.map((id) => job({ id })),
      'home',
    );
    const done = watchStep(
      seen,
      ids.map((id) => job({ id, status: 'done' })),
      'home',
    );
    expect(done.notices).toHaveLength(5);
  });
});

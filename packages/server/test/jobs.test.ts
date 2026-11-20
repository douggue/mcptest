import { describe, expect, test } from 'vitest';
import { JobStore } from '../src/jobs';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('JobStore', () => {
  test('starts a job and reports it as running', () => {
    const jobs = new JobStore(() => 'job-1');

    const job = jobs.start(() => new Promise(() => {}));

    expect(job).toEqual({
      id: 'job-1',
      status: 'running',
      progress: null,
      result: null,
      error: null,
    });
    expect(jobs.get('job-1')).toEqual(job);
  });

  test('refuses a second job while one is running', () => {
    const jobs = new JobStore();
    jobs.start(() => new Promise(() => {}));

    expect(jobs.start(async () => 'second')).toBeNull();
  });

  test('records progress, then the result when the work finishes', async () => {
    const jobs = new JobStore(() => 'job-1');
    const work = deferred<string>();

    jobs.start((report) => {
      report({ stage: 'reading-channels', channels: 7, step: 1 });
      return work.promise;
    });
    await settle();
    expect(jobs.get('job-1')?.progress).toEqual({
      stage: 'reading-channels',
      channels: 7,
      step: 1,
    });

    work.resolve('finished');
    await settle();

    expect(jobs.get('job-1')).toMatchObject({ status: 'done', result: 'finished', error: null });
  });

  test('records a failure with a cleaned, shortened message', async () => {
    const jobs = new JobStore(() => 'job-1');

    jobs.start(async () => {
      throw new Error(`bad \u001b[31mtitle ${'x'.repeat(600)}`);
    });
    await settle();

    const job = jobs.get('job-1');
    expect(job?.status).toBe('failed');
    expect(job?.error).not.toMatch(/\u001b/);
    expect(job?.error?.length).toBeLessThanOrEqual(300);
  });

  test('keeps file paths out of the message shown to the browser', async () => {
    const jobs = new JobStore(() => 'job-1');

    jobs.start(async () => {
      throw new Error('SQLITE_CANTOPEN: unable to open /home/someone/data/jgtube.db');
    });
    await settle();

    expect(jobs.get('job-1')?.error).toBe('SQLITE_CANTOPEN: unable to open <path>');
  });

  test('accepts a new job once the previous one has ended', async () => {
    const jobs = new JobStore();
    jobs.start(async () => 'first');
    await settle();

    expect(jobs.start(async () => 'second')).not.toBeNull();
  });

  test('returns null for an unknown job', () => {
    expect(new JobStore().get('nope')).toBeNull();
  });
});

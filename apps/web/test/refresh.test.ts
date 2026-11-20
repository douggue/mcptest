import { describe, expect, test } from 'vitest';
import { createApi, type RefreshReply } from '../src/lib/api';
import { describeGrowth } from '../src/lib/niches';
import {
  describeOutcome,
  describeProgress,
  describeRefresh,
  describeSchedule,
} from '../src/lib/refresh';

const NOW = new Date('2026-11-20T12:00:00Z');
const MINUTE_MS = 60_000;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString();

const reply = (overrides: Partial<RefreshReply> = {}): RefreshReply => ({
  last: null,
  channels: 306,
  due: 306,
  oldestReadAt: ago(600),
  everyHours: null,
  running: false,
  jobId: null,
  ...overrides,
});

const run = (minutes: number, overrides: Partial<NonNullable<RefreshReply['last']>> = {}) => ({
  startedAt: ago(minutes + 4),
  finishedAt: ago(minutes),
  refreshed: 48,
  failed: 0,
  stoppedEarly: false,
  ...overrides,
});

describe('describeRefresh', () => {
  test('says so when the stored channels have never been read again', () => {
    expect(describeRefresh(reply(), NOW)).toBe(
      'The 306 stored channels have not been read again yet. Reading them again a day apart shows what each one really gained.',
    );
  });

  test.each([
    [0, 'just now'],
    [1, '1 minute ago'],
    [45, '45 minutes ago'],
    [60, '1 hour ago'],
    [60 * 5 + 20, '5 hours ago'],
    [60 * 47, '47 hours ago'],
    [60 * 24 * 3, '3 days ago'],
  ])('says the last refresh ended %s minutes back as "%s"', (minutes, words) => {
    expect(describeRefresh(reply({ last: run(minutes), due: 0 }), NOW)).toBe(
      `Last refresh ${words}: 48 channels read again. Every stored channel has been read in the last day.`,
    );
  });

  test('says what could not be read, why a run stopped, and how much is still due', () => {
    const last = run(30, { refreshed: 3, failed: 5, stoppedEarly: true });

    expect(describeRefresh(reply({ last, due: 250 }), NOW)).toBe(
      'Last refresh 30 minutes ago: 3 channels read again, 5 could not be read; it stopped early because YouTube was refusing requests. 250 of 306 channels are due.',
    );
  });

  test('counts one channel as one', () => {
    const last = run(30, { refreshed: 1 });

    expect(describeRefresh(reply({ last, due: 1, channels: 1 }), NOW)).toBe(
      'Last refresh 30 minutes ago: 1 channel read again. 1 of 1 channel is due.',
    );
  });
});

describe('describeSchedule', () => {
  test('says how often the timer runs', () => {
    expect(describeSchedule(6)).toBe('Refreshes by itself every 6 hours while Jgtube is running.');
    expect(describeSchedule(1)).toBe('Refreshes by itself every hour while Jgtube is running.');
  });

  test('says how to turn the timer on when it is off', () => {
    expect(describeSchedule(null)).toContain('JGTUBE_REFRESH_HOURS=6');
  });
});

describe('a refresh under way and its outcome', () => {
  test('counts the channels tried so far', () => {
    expect(describeProgress({ stage: 'refreshing', done: 12, total: 50 })).toBe(
      'Reading channels again: 12 of 50',
    );
    expect(describeProgress(null)).toBe('Choosing the channels read longest ago');
  });

  test('sums up a finished run', () => {
    const outcome = { refreshed: 48, failed: 2, notAttempted: 0, stoppedEarly: false, stillDue: 9 };

    expect(describeOutcome(outcome)).toBe('Read 48 channels again; 2 could not be read.');
    expect(describeOutcome({ ...outcome, failed: 0 })).toBe('Read 48 channels again.');
    expect(describeOutcome({ ...outcome, refreshed: 0, failed: 0 })).toBe(
      'Nothing was due: every stored channel has been read in the last day.',
    );
    expect(describeOutcome({ ...outcome, stoppedEarly: true, notAttempted: 40 })).toBe(
      'Read 48 channels again; 2 could not be read. Stopped early because YouTube was refusing requests; 40 were not tried.',
    );
  });
});

describe('describeGrowth', () => {
  const since = '2026-11-17T12:00:00.000Z';

  test('says what a channel gained and over how long', () => {
    expect(describeGrowth({ views: 12_400, days: 3, since })).toBe('Gained 12.4K views in 3 days');
    expect(describeGrowth({ views: 950, days: 16, since })).toBe('Gained 950 views in 2 weeks');
  });

  test('does not claim a whole day for readings taken hours apart', () => {
    expect(describeGrowth({ views: 300, days: 0.3, since })).toBe(
      'Gained 300 views in under a day',
    );
  });
});

describe('the refresh API', () => {
  const answering = (data: unknown, status = 200) => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const api = createApi(async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ success: status < 400, data, error: status < 400 ? null : 'Busy' }),
        { status },
      );
    });
    return { api, calls };
  };

  test('reads when the store was last refreshed', async () => {
    const { api, calls } = answering(reply());

    await expect(api.refreshStatus()).resolves.toEqual(reply());
    expect(calls[0]?.url).toBe('/api/refresh');
  });

  test('starts a refresh and gives back the job to poll', async () => {
    const { api, calls } = answering({ jobId: 'job-9' }, 202);

    await expect(api.startRefresh()).resolves.toBe('job-9');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
    expect(calls[0]?.init?.body).toBe('{}');
  });

  test('raises the server message when a map is being made', async () => {
    await expect(answering(null, 409).api.startRefresh()).rejects.toThrow('Busy');
  });

  test('polls a refresh job', async () => {
    const job = { id: 'job-9', status: 'running', progress: null, result: null, error: null };
    const { api, calls } = answering(job);

    await expect(api.refreshJob('job 9')).resolves.toEqual(job);
    expect(calls[0]?.url).toBe('/api/jobs/job%209');
  });
});

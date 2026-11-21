import { describe, expect, test } from 'vitest';
import { channelLabel, channelName, conceptLabel, conceptName } from '../src/jobLabels';
import { RECENT_MS, heldRuns, holdRun, listJobs, progressText } from '../src/jobList';
import type { JobRecord } from '../src/jobs';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const record = (parts: Partial<JobRecord>): JobRecord => ({
  id: 'job',
  status: 'running',
  progress: null,
  error: null,
  label: null,
  startedAt: 0,
  finishedAt: null,
  ...parts,
});

const names = {
  listSavedChannels: () => [{ id: CHANNEL, title: 'Big Science' }],
  findConcept: (_channel: string, id: number) =>
    id === 4 ? { concept: { title: 'Why bridges sing' } } : null,
};
const broken = {
  listSavedChannels: () => {
    throw new Error('no store');
  },
  findConcept: () => {
    throw new Error('no store');
  },
};

describe('job labels', () => {
  test('name a channel by its saved title, else by the reference given', () => {
    expect(channelName(names, CHANNEL)).toBe('Big Science');
    expect(channelName(names, '@someone')).toBe('@someone');
    expect(channelName(broken, '@someone')).toBe('@someone');
    expect(channelName(names, 'x'.repeat(200))).toHaveLength(80);
  });

  test('name a concept by its title, else plainly', () => {
    expect(conceptName(names, CHANNEL, 4)).toBe('“Why bridges sing”');
    expect(conceptName(names, CHANNEL, 5)).toBe('a concept');
    expect(conceptName(broken, CHANNEL, 4)).toBe('a concept');
  });

  test('carry the channel id only when the reference is one', () => {
    expect(channelLabel(names, 'map', 'Making a map of', CHANNEL)).toEqual({
      kind: 'map',
      title: 'Making a map of Big Science',
      channelId: CHANNEL,
    });
    expect(channelLabel(names, 'map', 'Making a map of', '@x').channelId).toBeNull();
    expect(conceptLabel(names, 'claims', 'Checking claims for', CHANNEL, 4)).toEqual({
      kind: 'claims',
      title: 'Checking claims for “Why bridges sing”',
      channelId: CHANNEL,
      conceptId: 4,
    });
  });
});

describe('progressText', () => {
  test('reads each store’s progress in a few words', () => {
    expect(progressText({ text: 'Asking the AI' })).toBe('Asking the AI');
    expect(progressText({ stage: 'refreshing', done: 3, total: 9 })).toBe('3 of 9 done');
    expect(progressText({ stage: 'reading-channels', channels: 12 })).toBe(
      '12 channels found so far',
    );
    expect(progressText({ text: '' })).toBeNull();
    expect(progressText(null)).toBeNull();
    expect(progressText('text')).toBeNull();
    expect(progressText({ other: 1 })).toBeNull();
  });
});

describe('listJobs', () => {
  const now = 10 * RECENT_MS;

  test('lists running jobs first, then the recently finished, newest first', () => {
    const label = { kind: 'claims', title: 'Checking claims', channelId: CHANNEL, conceptId: 4 };
    const jobs = listJobs(
      [
        () => [
          record({ id: 'old', status: 'done', startedAt: 1, finishedAt: now - RECENT_MS - 1 }),
          record({ id: 'recent', status: 'failed', error: 'no', startedAt: 5, finishedAt: now }),
        ],
        () => [record({ id: 'run', label, progress: { text: 'Reading' }, startedAt: 2 })],
        () => [record({ id: 'later', status: 'done', startedAt: 9, finishedAt: now - 5 })],
      ],
      now,
    );

    expect(jobs.map(({ id }) => id)).toEqual(['run', 'later', 'recent']);
    expect(jobs[0]).toEqual({
      id: 'run',
      kind: 'claims',
      title: 'Checking claims',
      channelId: CHANNEL,
      conceptId: 4,
      videoId: null,
      engine: null,
      status: 'running',
      progress: 'Reading',
      error: null,
      startedAt: new Date(2).toISOString(),
      finishedAt: null,
    });
    expect(jobs[2]).toMatchObject({ kind: 'work', title: 'Working', error: 'no' });
    expect(jobs[2]?.finishedAt).toBe(new Date(now).toISOString());
  });

  test('keeps the list short', () => {
    const many = Array.from({ length: 30 }, (_, index) => record({ id: `j${index}` }));
    expect(listJobs([() => many])).toHaveLength(20);
  });
});

describe('holdRun', () => {
  test('lists work a request waits for, and hands it back', async () => {
    const held = heldRuns();
    const label = { kind: 'picture-check', title: 'Checking pictures', engine: 'codex' };

    expect(await holdRun(held, label, Promise.resolve('seen'))).toBe('seen');
    await settle();
    expect(held.list()).toMatchObject([{ status: 'done', label }]);
    await expect(holdRun(undefined, label, Promise.reject(new Error('x')))).rejects.toThrow('x');
  });
});

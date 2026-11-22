import { SqliteTeardownRepo, openDatabase, type StoredVideo } from '@jgtube/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { channelMeasurements, isMeasured, measureForChannel } from '../src/channelMeasure';
import { JobStore } from '../src/jobs';
import type { TeardownDeps } from '../src/teardownEngine';
import { channelRuns } from '../src/teardownRoutes';
import { HOST, UNUSED_HUB, get, stubEngine } from './support';
import { MEASURED } from './teardownFixtures';

const NOW = new Date('2026-11-22T12:00:00Z');
const DAY = 86_400_000;
let root: string;
let repo: SqliteTeardownRepo;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-channel-measure-'));
  repo = new SqliteTeardownRepo(openDatabase(':memory:'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const teardown = (ok = true, folder: string | null = root): TeardownDeps =>
  ({
    now: () => NOW,
    stop: new AbortController().signal,
    repo,
    folder: () => folder,
    measure: async () =>
      ok ? { ok: true, measurements: MEASURED } : { ok: false, reason: 'ffmpeg failed' },
  }) as unknown as TeardownDeps;

describe('measuring a channel’s video', () => {
  test('measures and keeps it with its captions, then keeps it; fresh measures again', async () => {
    const captions = [{ at: 1, text: 'Hello.' }];
    expect(
      await measureForChannel(teardown(), 'aaaaaaaaaaa', '/v.mp4', false, captions, () => {}),
    ).toEqual({ state: 'made' });
    expect(isMeasured(repo, 'aaaaaaaaaaa')).toBe(true);
    expect(repo.find('aaaaaaaaaaa', 'transcript')?.json).toContain('Hello.');
    expect(
      await measureForChannel(teardown(), 'aaaaaaaaaaa', '/v.mp4', false, null, () => {}),
    ).toEqual({ state: 'kept' });
    expect(
      await measureForChannel(teardown(), 'aaaaaaaaaaa', '/v.mp4', true, [], () => {}),
    ).toEqual({ state: 'made' });
  });

  test('says why when it cannot be measured', async () => {
    expect(
      await measureForChannel(teardown(false), 'bbbbbbbbbbb', '/v.mp4', false, null, () => {}),
    ).toEqual({
      state: 'failed',
      reason: 'It could not be measured: ffmpeg failed',
    });
    expect(
      await measureForChannel(teardown(true, null), 'bbbbbbbbbbb', '/v.mp4', false, null, () => {}),
    ).toMatchObject({
      state: 'failed',
      reason: expect.stringMatching(/no downloads folder/),
    });
  });
});

describe('the channel’s measurements', () => {
  const stored = (n: number, views: number, ageDays: number): StoredVideo => ({
    id: `vid${String(n).padStart(8, '0')}`,
    channelId: `UC${'a'.repeat(22)}`,
    title: n < 3 ? `Why ${n} Things Fell` : `a small walk ${n}`,
    published: { date: new Date(NOW.getTime() - ageDays * DAY), precision: 'day', raw: 'x' },
    durationSeconds: 600,
    views,
    fetchedAt: NOW,
  });

  test('puts winners and ordinary videos side by side from what is stored', async () => {
    const videos = [
      stored(1, 500_000, 60),
      stored(2, 400_000, 60),
      ...Array.from({ length: 12 }, (_, i) => stored(i + 3, 1000 + i, 60 + i)),
    ];
    await measureForChannel(
      teardown(),
      'vid00000001',
      '/v.mp4',
      false,
      [{ at: 0, text: 'One two. Three.' }],
      () => {},
    );
    repo.save('vid00000001', 'watch', { engine: 'agy', json: '{}' }, NOW);

    const facts = channelMeasurements(
      {
        now: () => NOW,
        teardowns: repo,
        studies: { find: () => null },
        thumbnailTags: (ids) =>
          new Map(ids.slice(0, 1).map((id) => [id, { face: 'none', words: 2 }])),
        storedCaptions: () => null,
      },
      videos,
    );

    expect(facts.basis).toMatchObject({
      measured: 1,
      heardWithSound: [{ videoId: 'vid00000001', by: 'agy' }],
    });
    expect(facts.videos.find((video) => video.videoId === 'vid00000001')).toMatchObject({
      role: 'winner',
      measured: true,
    });
    expect(facts.thumbnails.tagged.winners).toBe(1);
    expect(facts.titles.winners).toBeGreaterThan(0);
  });
});

describe('what a channel breakdown takes', () => {
  test('counts the AI runs and the videos measured in code', () => {
    expect(channelRuns(3, true)).toEqual({
      videos: 3,
      contrast: 2,
      measuredInCode: 5,
      aiRuns: 13,
      watch: true,
    });
    expect(channelRuns(1, false)).toMatchObject({ aiRuns: 8 });
  });

  test('is answered at GET /api/breakdowns/runs, and refuses a count out of range', async () => {
    const app = createApp({
      engine: stubEngine({
        hub: { ...UNUSED_HUB, teardownRuns: async () => ({ runs: 9, kept: 0, watch: false }) },
      }),
      jobs: new JobStore(),
      allowedHosts: [HOST],
    });
    expect(await (await get(app, '/api/breakdowns/runs?videos=5')).json()).toMatchObject({
      data: { videos: 5, aiRuns: 12, measuredInCode: 7 },
    });
    expect((await get(app, '/api/breakdowns/runs?videos=9')).status).toBe(400);
    expect((await get(app, '/api/breakdowns/runs')).status).toBe(200);
  });
});

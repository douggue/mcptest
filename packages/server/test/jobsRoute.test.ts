import { describe, expect, test } from 'vitest';
import { createApp, type Engine } from '../src/app';
import type { JobEntry } from '../src/jobList';
import { JobStore } from '../src/jobs';
import type { ClaimsOutcome } from '../src/researchEngine';
import type { RiskAskOutcome, RiskView } from '../src/riskTypes';
import type { ThumbReviewOutcome } from '../src/thumbReviewTypes';
import { CHANNEL_ID, HOST, get, post, read, stubEngine, withExtras } from './support';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const named: Partial<Engine> = {
  listSavedChannels: () => [
    {
      id: CHANNEL_ID,
      title: 'Big Science',
      handle: null,
      subscribers: null,
      logoUrl: null,
      mapMadeAt: '2026-01-01T00:00:00.000Z',
      channelCount: 3,
    },
  ],
  findConcept: (_channel, id) => (id === 7 ? ({ concept: { title: 'Bridges' } } as never) : null),
};

const appWith = (parts: Partial<Engine>) =>
  createApp({
    engine: stubEngine({ ...named, ...parts }),
    jobs: new JobStore(),
    allowedHosts: [HOST],
  });

const listed = async (app: ReturnType<typeof createApp>): Promise<JobEntry[]> =>
  (await read<{ jobs: JobEntry[] }>(await get(app, '/api/jobs'))).data.jobs;

describe('GET /api/jobs', () => {
  test('answers an empty list when nothing has run', async () => {
    const reply = await get(appWith({}), '/api/jobs');

    expect(reply.status).toBe(200);
    expect(await read(reply)).toEqual({
      success: true,
      data: { jobs: [] },
      error: null,
      meta: null,
    });
  });

  test('lists a running risk check by name and refuses a second one while it runs', async () => {
    const asked = deferred<RiskAskOutcome>();
    const view: RiskView = { centerChannelId: CHANNEL_ID, concepts: [], check: null };
    const app = appWith(withExtras({ findRisk: () => view, askRisk: () => asked.promise }));
    const body = { channel: CHANNEL_ID, conceptId: 7 };

    expect((await post(app, '/api/risk/ask', body)).status).toBe(202);
    await settle();
    const again = await post(app, '/api/risk/ask', body);

    expect(again.status).toBe(409);
    expect((await read(again)).error).toMatch(/already/);
    expect(await listed(app)).toMatchObject([
      {
        kind: 'risk-check',
        title: 'Checking before publishing “Bridges”',
        channelId: CHANNEL_ID,
        conceptId: 7,
        status: 'running',
        progress: 'Asking the AI to check the script before publishing',
        finishedAt: null,
      },
    ]);
    asked.resolve({ claims: 1, notes: 0, dropped: 0, engine: 'claude' } as RiskAskOutcome);
    await settle();
    await settle();
    const [done] = await listed(app);
    expect(done?.status).toBe('done');
    expect(done?.finishedAt).not.toBeNull();
  });

  test('names a thumbnail review by its video, a claims check and a map by their names', async () => {
    const review = deferred<ThumbReviewOutcome>();
    const claims = deferred<ClaimsOutcome>();
    const app = appWith({
      ...withExtras({
        thumbnailVideos: () => ({}) as never,
        askThumbnailReview: () => review.promise,
      }),
      checkClaims: () => claims.promise,
      crawl: () => new Promise(() => {}),
    });

    await post(app, '/api/thumbnail-review/ask', { channel: CHANNEL_ID, videoId: 'abcdefghijk' });
    await post(app, '/api/lab/claims', { channel: CHANNEL_ID, concept: 7 });
    await post(app, '/api/maps', { channel: CHANNEL_ID });
    await settle();
    const jobs = await listed(app);

    expect(jobs.map(({ kind, title }) => [kind, title])).toEqual(
      expect.arrayContaining([
        ['thumbnail-review', 'Reviewing a thumbnail'],
        ['map', 'Making a map of Big Science'],
      ]),
    );
    // An AI run is under way, so the claims check is refused and not listed.
    expect(jobs.find(({ kind }) => kind === 'claims')).toBeUndefined();
    expect(jobs.find(({ kind }) => kind === 'thumbnail-review')?.videoId).toBe('abcdefghijk');
  });

  test('lists a claims check by its concept', async () => {
    const app = appWith({ checkClaims: () => new Promise(() => {}) });

    await post(app, '/api/lab/claims', { channel: CHANNEL_ID, concept: 7 });
    await settle();

    expect(await listed(app)).toMatchObject([
      { kind: 'claims', title: 'Checking the claims of “Bridges”', conceptId: 7 },
    ]);
  });

  test('lists an analysis the request is waiting on, then as done', async () => {
    const answer = deferred<{ text: string }>();
    const app = appWith({
      analyse: async () => ({
        ...(await answer.promise),
        turns: null,
        engine: 'claude',
        skipped: [],
      }),
    });

    const pending = post(app, '/api/analyses', { analysis: 'topics', channel: CHANNEL_ID });
    await settle();
    const [running] = await listed(app);
    expect(running).toMatchObject({ kind: 'analysis', channelId: CHANNEL_ID, status: 'running' });
    expect(running?.title).toMatch(/Big Science$/);

    answer.resolve({ text: 'Answer' });
    expect((await pending).status).toBe(200);
    await settle();
    expect((await listed(app))[0]?.status).toBe('done');
  });

  test('lists a picture check under its engine', async () => {
    const app = appWith({ checkPictures: () => new Promise(() => {}) });

    void post(app, '/api/engines/picture-check', { engine: 'agy' });
    await settle();

    expect(await listed(app)).toMatchObject([
      { kind: 'picture-check', engine: 'agy', status: 'running' },
    ]);
  });

  test('is read-only and answers only to its own address', async () => {
    const app = appWith({});

    expect((await post(app, '/api/jobs', {})).status).toBe(405);
    expect((await get(app, '/api/jobs', 'evil.example')).status).toBe(403);
  });
});

import { describe, expect, test } from 'vitest';
import { createApp, type Engine } from '../src/app';
import { JobStore } from '../src/jobs';
import type {
  ConceptOutcome,
  ConceptRequest,
  FormulaList,
  HookLibrary,
  LabOutcome,
} from '../src/labTypes';
import { CHANNEL_ID, HOST, get, post, read, stubEngine } from './support';

const A = 'aaaaaaaaaa1';
const B = 'bbbbbbbbbb1';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const outcome: ConceptOutcome = {
  kind: 'concepts',
  batchId: 3,
  added: [],
  asked: 10,
  unread: 0,
  note: null,
  engine: 'claude',
  skipped: [],
};
const formulas: FormulaList = { windowDays: 90, runAt: null, engine: null, formulas: [] };
const library: HookLibrary = { centerChannelId: CHANNEL_ID, seconds: 60, cap: 12, hooks: [] };

const appWith = (parts: Partial<Engine>) =>
  createApp({ engine: stubEngine(parts), jobs: new JobStore(), allowedHosts: [HOST] });

interface JobReply {
  readonly status: string;
  readonly progress: { readonly step: string; readonly text: string } | null;
  readonly result: LabOutcome | null;
  readonly error: string | null;
}

const jobOf = async (app: ReturnType<typeof appWith>, response: Response): Promise<JobReply> => {
  const { jobId } = (await read<{ jobId: string }>(response)).data;
  await settle();
  return (await read<JobReply>(await get(app, `/api/jobs/${jobId}`))).data;
};

const batch = { channel: CHANNEL_ID, inspiration: [A, B], length: 'long' };

describe('POST /api/lab/concepts', () => {
  test('checks what was chosen against the store, then starts the batch as a job', async () => {
    const checked: ConceptRequest[] = [];
    const made: ConceptRequest[] = [];
    const app = appWith({
      conceptProblem: (request) => {
        checked.push(request);
        return null;
      },
      makeConcepts: async (request, report) => {
        made.push(request);
        report({ step: 'asking', text: 'Asking the AI' });
        return outcome;
      },
    });

    const started = await post(app, '/api/lab/concepts', {
      ...batch,
      hookModels: [B],
      format: { source: 'formula', id: 4 },
      angle: '  machines that outlived us  ',
      engine: 'codex',
    });
    const job = await jobOf(app, started);

    const expected: ConceptRequest = {
      centerChannelId: CHANNEL_ID,
      inspiration: [A, B],
      hookModels: [B],
      format: { source: 'formula', id: 4 },
      angle: 'machines that outlived us',
      length: 'long',
      only: 'codex',
    };
    expect(started.status).toBe(202);
    expect(checked).toEqual([expected]);
    expect(made).toEqual([expected]);
    expect(job).toMatchObject({ status: 'done', result: outcome, error: null });
  });

  test('takes no angle, no format and no engine as none', async () => {
    const made: ConceptRequest[] = [];
    const app = appWith({
      conceptProblem: () => null,
      makeConcepts: async (request) => {
        made.push(request);
        return outcome;
      },
    });

    await post(app, '/api/lab/concepts', { ...batch, angle: '   ', length: 'shorts' });
    await settle();

    expect(made).toEqual([
      {
        centerChannelId: CHANNEL_ID,
        inspiration: [A, B],
        hookModels: [],
        format: null,
        angle: null,
        length: 'shorts',
        only: undefined,
      },
    ]);
  });

  test.each([
    ['no picked video', { ...batch, inspiration: [] }],
    [
      'six picked videos',
      {
        ...batch,
        inspiration: [A, B, 'c'.repeat(11), 'd'.repeat(11), 'e'.repeat(11), 'f'.repeat(11)],
      },
    ],
    ['the same video twice', { ...batch, inspiration: [A, A] }],
    ['a picked video that is not a video id', { ...batch, inspiration: ['../../etc'] }],
    ['a channel that is not a channel id', { ...batch, channel: '@handle' }],
    ['a length that is neither long nor shorts', { ...batch, length: 'medium' }],
    ['an angle of two lines', { ...batch, angle: 'one\ntwo' }],
    ['an angle with a control character', { ...batch, angle: 'bell\u0007' }],
    ['an angle of more than 200 characters', { ...batch, angle: 'x'.repeat(201) }],
    ['a format given as free text', { ...batch, format: 'Why [Thing] Left' }],
    ['a format from nowhere', { ...batch, format: { source: 'web', key: 'x' } }],
    ['an engine that does not exist', { ...batch, engine: 'gpt' }],
  ])('refuses %s before the store is read', async (_name, body) => {
    let reached = 0;
    const app = appWith({
      conceptProblem: () => {
        reached += 1;
        return null;
      },
    });

    expect((await post(app, '/api/lab/concepts', body)).status).toBe(400);
    expect(reached).toBe(0);
  });

  test('answers with the reason when what was chosen does not belong to this channel', async () => {
    const app = appWith({
      conceptProblem: () =>
        'The video aaaaaaaaaa1 is not a stored video of a channel on this channel’s map.',
    });

    const refused = await post(app, '/api/lab/concepts', batch);

    expect(refused.status).toBe(400);
    expect((await read(refused)).error).toMatch(/not a stored video/);
  });

  test('is refused from another site and when it is not JSON', async () => {
    const app = appWith({});

    const crossSite = await post(app, '/api/lab/concepts', batch, {
      origin: 'https://evil.example',
    });
    const form = await post(app, '/api/lab/concepts', 'channel=x', {
      'content-type': 'text/plain',
    });

    expect(crossSite.status).toBe(403);
    expect(form.status).toBe(415);
  });

  test('runs one AI job at a time, and reports a failed one with its reason', async () => {
    let fail: (error: Error) => void = () => {};
    const app = appWith({
      conceptProblem: () => null,
      makeConcepts: () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
      analyse: async () => ({ text: 'x', engine: 'claude', skipped: [], turns: 1 }),
    });

    const first = await post(app, '/api/lab/concepts', batch);
    await settle();
    const second = await post(app, '/api/lab/concepts', batch);
    const analysis = await post(app, '/api/analyses', { analysis: 'topics', channel: CHANNEL_ID });
    fail(new Error('The AI answered, but not with concepts. Nothing was changed.'));
    const job = await jobOf(app, first);
    const third = await post(app, '/api/lab/concepts', batch);

    expect(second.status).toBe(409);
    expect(analysis.status).toBe(409);
    expect(job).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/Nothing was changed/),
    });
    expect(third.status).toBe(202);
  });
});

describe('the routes that grow, keep and clear concepts', () => {
  test('a twist and a more-like-this start a job for a concept of this channel', async () => {
    const grown: unknown[] = [];
    const app = appWith({
      findConcept: (channel, concept) => (concept === 7 ? ({ channel } as never) : null),
      growConcept: async (kind, channel, concept, only) => {
        grown.push([kind, channel, concept, only]);
        return outcome;
      },
    });

    const twist = await post(app, '/api/lab/concepts/twist', { channel: CHANNEL_ID, concept: 7 });
    await settle();
    const more = await post(app, '/api/lab/concepts/more', {
      channel: CHANNEL_ID,
      concept: 7,
      engine: 'claude',
    });
    await settle();
    const missing = await post(app, '/api/lab/concepts/twist', { channel: CHANNEL_ID, concept: 8 });
    const bad = await post(app, '/api/lab/concepts/twist', {
      channel: CHANNEL_ID,
      concept: 'seven',
    });

    expect([twist.status, more.status, missing.status, bad.status]).toEqual([202, 202, 404, 400]);
    expect(grown).toEqual([
      ['twist', CHANNEL_ID, 7, undefined],
      ['more', CHANNEL_ID, 7, 'claude'],
    ]);
  });

  test('keeping answers 404 for a concept that is not this channel’s', async () => {
    const kept: unknown[] = [];
    const app = appWith({
      setConceptKept: (channel, concept, value) => {
        kept.push([channel, concept, value]);
        return concept === 7;
      },
    });

    const done = await post(app, '/api/lab/concepts/keep', {
      channel: CHANNEL_ID,
      concept: 7,
      kept: true,
    });
    const missing = await post(app, '/api/lab/concepts/keep', {
      channel: CHANNEL_ID,
      concept: 8,
      kept: false,
    });
    const bad = await post(app, '/api/lab/concepts/keep', { channel: CHANNEL_ID, concept: 7 });

    expect([done.status, missing.status, bad.status]).toEqual([200, 404, 400]);
    expect((await read(done)).data).toEqual({ concept: 7, kept: true });
    expect(kept).toEqual([
      [CHANNEL_ID, 7, true],
      [CHANNEL_ID, 8, false],
    ]);
  });

  test('clearing says how many went', async () => {
    const app = appWith({ clearConcepts: () => 6 });

    const cleared = await post(app, '/api/lab/concepts/clear', { channel: CHANNEL_ID });

    expect((await read(cleared)).data).toEqual({ removed: 6 });
    expect((await post(app, '/api/lab/concepts/clear', {})).status).toBe(400);
  });

  test('the list is read for one channel id, and is 404 without a map', async () => {
    const app = appWith({
      listConcepts: (channel) => (channel === CHANNEL_ID ? { concepts: [] } : null),
    });

    const found = await get(app, `/api/lab/concepts?channel=${CHANNEL_ID}`);
    const none = await get(app, '/api/lab/concepts?channel=UCaaaaaaaaaaaaaaaaaaaaaa');
    const bad = await get(app, '/api/lab/concepts?channel=@handle');

    expect([found.status, none.status, bad.status]).toEqual([200, 404, 400]);
    expect((await read(found)).data).toEqual({ concepts: [] });
  });

  test('a path of the lab answers only to the methods it has', async () => {
    const app = appWith({});
    const put = (path: string) =>
      app(new Request(`http://${HOST}${path}`, { method: 'PUT', headers: { host: HOST } }));

    expect((await put('/api/lab/concepts')).status).toBe(405);
    expect((await get(app, '/api/lab/concepts/keep')).status).toBe(405);
  });
});

describe('where else, formulas and hooks', () => {
  test('where-else starts a job for a channel with a map', async () => {
    const app = appWith({
      listConcepts: (channel) => (channel === CHANNEL_ID ? { concepts: [] } : null),
      whereElse: async (_channel, only) => ({
        kind: 'answer',
        text: `asked of ${only}`,
        engine: 'claude',
        skipped: [],
      }),
    });

    const started = await post(app, '/api/lab/where-else', {
      channel: CHANNEL_ID,
      engine: 'claude',
    });
    const job = await jobOf(app, started);
    const none = await post(app, '/api/lab/where-else', { channel: 'UCaaaaaaaaaaaaaaaaaaaaaa' });

    expect(job.result).toMatchObject({ kind: 'answer', text: 'asked of claude' });
    expect(none.status).toBe(404);
  });

  test('formulas are read and found for a window of 30 or 90 days, 90 unless said', async () => {
    const windows: number[] = [];
    const app = appWith({
      listFormulas: (_channel, window) => {
        windows.push(window);
        return { ...formulas, windowDays: window };
      },
      findFormulas: async (_channel, window) => ({
        kind: 'formulas',
        list: { ...formulas, windowDays: window },
        proposed: 0,
        unread: 0,
        dropped: [],
        engine: 'claude',
        skipped: [],
      }),
    });

    const usual = await get(app, `/api/lab/formulas?channel=${CHANNEL_ID}`);
    const month = await get(app, `/api/lab/formulas?channel=${CHANNEL_ID}&window=30`);
    const odd = await get(app, `/api/lab/formulas?channel=${CHANNEL_ID}&window=45`);
    const started = await post(app, '/api/lab/formulas', { channel: CHANNEL_ID, window: 30 });
    const job = await jobOf(app, started);
    const refused = await post(app, '/api/lab/formulas', { channel: CHANNEL_ID, window: 45 });

    expect([usual.status, month.status, odd.status, refused.status]).toEqual([200, 200, 400, 400]);
    expect(windows.slice(0, 2)).toEqual([90, 30]);
    expect(job.result).toMatchObject({ kind: 'formulas', list: { windowDays: 30 } });
  });

  test('the hook library is read, built without taking the AI’s slot, and labelled as an AI run', async () => {
    let release: () => void = () => {};
    const app = appWith({
      hookLibrary: (channel) => (channel === CHANNEL_ID ? library : null),
      buildHookLibrary: () =>
        new Promise((resolve) => {
          release = () => resolve({ kind: 'hooks-built', library, read: 2, failed: [] });
        }),
      labelHooks: async () => ({
        kind: 'hooks-labelled',
        library,
        labelled: 2,
        unread: 0,
        engine: 'claude',
        skipped: [],
      }),
      analyse: async () => ({ text: 'x', engine: 'claude', skipped: [], turns: 1 }),
    });

    const shown = await get(app, `/api/lab/hooks?channel=${CHANNEL_ID}`);
    const building = await post(app, '/api/lab/hooks/build', { channel: CHANNEL_ID });
    await settle();
    const analysis = await post(app, '/api/analyses', { analysis: 'topics', channel: CHANNEL_ID });
    const labelWhileBuilding = await post(app, '/api/lab/hooks/label', { channel: CHANNEL_ID });
    release();
    const built = await jobOf(app, building);
    const labelling = await post(app, '/api/lab/hooks/label', { channel: CHANNEL_ID });
    const labelled = await jobOf(app, labelling);
    const none = await post(app, '/api/lab/hooks/build', { channel: 'UCaaaaaaaaaaaaaaaaaaaaaa' });

    expect((await read(shown)).data).toEqual(library);
    expect(building.status).toBe(202);
    expect(analysis.status).toBe(200);
    expect(labelWhileBuilding.status).toBe(409);
    expect(built.result).toMatchObject({ kind: 'hooks-built', read: 2 });
    expect(labelled.result).toMatchObject({ kind: 'hooks-labelled', labelled: 2 });
    expect(none.status).toBe(404);
  });
});

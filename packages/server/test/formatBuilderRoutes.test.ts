import {
  SqliteFormatRepo,
  SqliteIngredientRepo,
  openDatabase,
  type IngredientDraft,
} from '@jgtube/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp, type JobOutcome, type JobProgress } from '../src/app';
import { EMPTY_SHELF, formatBuilder, mixPicturePath } from '../src/formatBuilder';
import type { FormatBuilderDeps } from '../src/formatBuilder';
import type { FormatView } from '../src/formatBuilderTypes';
import type { MixAsk } from '../src/formatMixRequests';
import { JobStore } from '../src/jobs';
import { HOST, get, post, read, stubEngine } from './support';

const NOW = new Date('2026-11-24T12:00:00Z');
const A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const B = 'UCbbbbbbbbbbbbbbbbbbbbbb';
const PATH = '/api/format/formats';

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-format-builder-'));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

const draft = (
  layer: IngredientDraft['layer'],
  key: string,
  parts: Partial<IngredientDraft> = {},
): IngredientDraft => ({
  layer,
  name: `${layer} ${key}`,
  source: 'note',
  sourceKey: key,
  sourceLabel: 'Your note',
  centerChannelId: null,
  channelIds: [A],
  details: {},
  evidence: { score: null, scoredVideos: 0, videos: 1, channels: 1, measured: [] },
  media: [],
  ...parts,
});

function setup(
  answer = '',
  parts: Partial<FormatBuilderDeps> = {},
  gate: Promise<void> = Promise.resolve(),
) {
  const db = openDatabase(':memory:');
  const shelf = new SqliteIngredientRepo(db);
  const asked: MixAsk[] = [];
  const engine = formatBuilder({
    formats: new SqliteFormatRepo(db),
    shelf,
    now: () => NOW,
    channelTitle: (id) => (id === A ? 'Alpha' : null),
    picturePath: mixPicturePath(() => folder),
    askMix: async (ask) => {
      asked.push(ask);
      await gate;
      return { engine: 'claude', text: answer, skipped: [] } as never;
    },
    ...parts,
  });
  return { engine, shelf, asked };
}

describe('the format builder engine', () => {
  test('makes, changes, copies and removes formats, each with its checks', () => {
    const { engine, shelf } = setup();
    const title = shelf.add(draft('title', '1'), NOW);
    const hook = shelf.add(draft('hook', '2'), NOW);
    const sound = shelf.add(draft('sound', '3', { channelIds: [B] }), NOW);
    const made = engine.createFormat('Long-form', 600);
    expect(made).toMatchObject({ name: 'Long-form', targetSeconds: 600, topChannelTitle: null });
    const changed = engine.updateFormat(made.id, {
      slots: {
        title: { ingredientId: title.id, note: '' },
        hook: { ingredientId: hook.id, note: '' },
        sound: { ingredientId: sound.id, note: '' },
      },
    });
    expect(changed?.checks.originality).toMatchObject({ copiesOneChannel: true, fromChannel: 2 });
    expect(changed?.topChannelTitle).toBe('Alpha');
    expect(changed?.checks.unproven).toEqual(['title', 'hook', 'sound']);
    shelf.remove(sound.id);
    expect(engine.listFormats()[0]?.slots.sound).toBeUndefined();
    const copy = engine.duplicateFormat(made.id);
    expect(copy).toMatchObject({ name: 'Long-form v2', copiedFrom: made.id });
    expect(engine.formatName(made.id)).toBe('Long-form');
    expect(engine.formatName(99)).toBeNull();
    expect(engine.updateFormat(99, { name: 'x' })).toBeNull();
    expect(engine.duplicateFormat(99)).toBeNull();
    expect(engine.removeFormat(made.id)).toBe(true);
    expect(engine.listFormats().map((one) => one.name)).toEqual(['Long-form v2']);
    expect(() => engine.createFormat('', null)).toThrow(/name/);
  });

  test('a mix is asked with the shelf’s pictures and kept only as checked', async () => {
    mkdirSync(join(folder, 'formats'));
    writeFileSync(join(folder, 'formats', 'abcdefghijk.png'), Buffer.from([0x89]));
    const answer = JSON.stringify({
      summary: 'S',
      slots: [{ layer: 'title', ingredient: 1, reason: 'r' }],
    });
    const { engine, shelf, asked } = setup(answer);
    shelf.add(
      draft('title', '1', {
        media: [
          { kind: 'image', file: 'abcdefghijk.png' },
          { kind: 'thumbnail', videoId: 'aaaaaaaaaa1' },
        ],
      }),
      NOW,
    );
    const made = engine.createFormat('Shorts', 45);
    const progress: string[] = [];
    const view = await engine.suggestMix(made.id, A, undefined, (step) => progress.push(step.step));
    expect(progress).toEqual(['asking', 'checking']);
    expect(asked[0]).toMatchObject({
      formatId: made.id,
      channel: A,
      thumbnails: ['aaaaaaaaaa1'],
      pictures: [{ name: 'i1-1.png', path: join(folder, 'formats', 'abcdefghijk.png') }],
    });
    expect(view.suggestion).toMatchObject({
      engine: 'claude',
      summary: 'S',
      slots: [{ layer: 'title', ingredientId: 1 }],
    });
    expect(view.slots).toEqual({});
    expect(engine.shelfForMix(made.id)?.ingredients[0]?.pictures).toEqual(['i1-1.png']);
    expect(engine.shelfForMix(99)).toBeNull();
    expect(await engine.mixPicture('i1-1.png')).toEqual(new Uint8Array([0x89]));
    expect(await engine.mixPicture('i1-2.png')).toBeNull();
  });

  test('a mix is refused for no format, an empty shelf or an answer with nothing on the shelf', async () => {
    const { engine, shelf } = setup('{"slots": []}');
    const made = engine.createFormat('Shorts', null);
    const noop = () => undefined;
    await expect(engine.suggestMix(99, null, undefined, noop)).rejects.toThrow('no such format');
    await expect(engine.suggestMix(made.id, null, undefined, noop)).rejects.toThrow(EMPTY_SHELF);
    shelf.add(draft('title', '1'), NOW);
    await expect(engine.suggestMix(made.id, null, undefined, noop)).rejects.toThrow(
      /The AI answered, but no slot named an ingredient on the shelf/,
    );
  });

  test('a picture that cannot be read or found has no bytes and no path', async () => {
    const { engine, shelf } = setup('', { picturePath: () => null });
    shelf.add(
      draft('visual', '1', {
        media: [{ kind: 'keyframe', videoId: 'aaaaaaaaaa1', file: 'k-001.jpg' }],
      }),
      NOW,
    );
    expect(await engine.mixPicture('i1-1.jpg')).toBeNull();
    const missing = setup();
    missing.shelf.add(
      draft('visual', '1', { media: [{ kind: 'image', file: 'abcdefghijk.jpg' }] }),
      NOW,
    );
    expect(await missing.engine.mixPicture('i1-1.jpg')).toBeNull();
    const path = mixPicturePath(() => folder);
    expect(path({ kind: 'teardown', videoId: 'aaaaaaaaaa1', file: 'k-001.jpg' })).toContain(
      'k-001.jpg',
    );
    expect(path({ kind: 'image', file: '../../etc' })).toBeNull();
  });
});

describe('the format routes', () => {
  function appWith(answer = '', gate?: Promise<void>) {
    const built = setup(answer, {}, gate);
    const app = createApp({
      engine: stubEngine({ formatBuilder: built.engine }),
      jobs: new JobStore<JobOutcome, JobProgress>(),
      allowedHosts: [HOST],
    });
    return { app, ...built };
  }

  test('list, make, change, copy and remove formats, refusing what breaks a rule', async () => {
    const { app } = appWith();
    const made = await read<FormatView>(
      await post(app, PATH, { name: 'Long-form', targetSeconds: 600 }),
    );
    expect(made.data).toMatchObject({ name: 'Long-form', checks: { clashes: [] } });
    const id = made.data.id;
    expect((await post(app, PATH, { name: '' })).status).toBe(400);
    expect((await post(app, PATH, { name: 'Short', targetSeconds: 3 })).status).toBe(400);
    const renamed = await post(app, `${PATH}/update`, { id, name: 'Main', notes: 'n' });
    expect((await read<FormatView>(renamed)).data).toMatchObject({ name: 'Main', notes: 'n' });
    expect((await post(app, `${PATH}/update`, { id: 99, name: 'x' })).status).toBe(404);
    expect((await post(app, `${PATH}/update`, { id, targetSeconds: 1 })).status).toBe(400);
    expect((await post(app, `${PATH}/update`, { id: 'x' })).status).toBe(400);
    expect((await post(app, `${PATH}/duplicate`, { id })).status).toBe(201);
    expect((await post(app, `${PATH}/duplicate`, { id: 99 })).status).toBe(404);
    const list = await read<{ formats: FormatView[] }>(await get(app, PATH));
    expect(list.data.formats.map((one) => one.name).sort()).toEqual(['Main', 'Main v2']);
    expect((await post(app, `${PATH}/remove`, { id })).status).toBe(200);
    expect((await post(app, `${PATH}/remove`, { id })).status).toBe(404);
    expect((await post(app, `${PATH}/remove`, {})).status).toBe(400);
    expect((await get(app, `${PATH}/remove`)).status).toBe(405);
    const del = await app(
      new Request(`http://${HOST}${PATH}`, { method: 'DELETE', headers: { host: HOST } }),
    );
    expect(del.status).toBe(405);
  });

  test('formats are listed and made per channel', async () => {
    const { app } = appWith();
    await post(app, PATH, { name: 'Long-form', channel: A });
    await post(app, PATH, { name: 'Shorts', channel: A });
    await post(app, PATH, { name: 'Theirs', channel: B });
    await post(app, PATH, { name: 'Loose' });
    const names = async (query: string) =>
      (await read<{ formats: FormatView[] }>(await get(app, `${PATH}${query}`))).data.formats.map(
        (one) => one.name,
      );
    expect(await names(`?channel=${A}`)).toEqual(['Shorts', 'Long-form']);
    expect(await names(`?channel=${B}`)).toEqual(['Theirs']);
    expect(await names('')).toEqual(['Loose']);
    expect((await get(app, `${PATH}?channel=bad`)).status).toBe(400);
    expect((await post(app, PATH, { name: 'X', channel: 'bad' })).status).toBe(400);
  });

  test('Suggest a mix runs as a job listed in Working, one AI run at a time', async () => {
    const answer = JSON.stringify({
      summary: 'S',
      slots: [{ layer: 'title', ingredient: 1, reason: 'r' }],
    });
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, shelf } = appWith(answer, gate);
    shelf.add(draft('title', '1'), NOW);
    const id = (await read<FormatView>(await post(app, PATH, { name: 'Long-form' }))).data.id;
    expect((await post(app, `${PATH}/suggest`, { id: 99 })).status).toBe(404);
    expect((await post(app, `${PATH}/suggest`, { id, channel: 'bad' })).status).toBe(400);
    const started = await post(app, `${PATH}/suggest`, { id, channel: A, engine: 'claude' });
    expect(started.status).toBe(202);
    expect((await post(app, `${PATH}/suggest`, { id })).status).toBe(409);
    const { jobId } = (await read<{ jobId: string }>(started)).data;
    const jobs = await read<{ jobs: { kind: string; title: string; channelId: string }[] }>(
      await get(app, '/api/jobs'),
    );
    expect(jobs.data.jobs).toContainEqual(
      expect.objectContaining({
        kind: 'format-mix',
        title: 'Suggesting a mix for “Long-form”',
        channelId: A,
      }),
    );
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const job = await read<{ status: string; result: FormatView }>(
      await get(app, `/api/jobs/${jobId}`),
    );
    expect(job.data.status).toBe('done');
    expect(job.data.result.suggestion?.slots[0]?.ingredientId).toBe(1);
    expect((await post(app, `${PATH}/suggest`, { id })).status).toBe(202);
  });
});

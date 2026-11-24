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
import { EMPTY_SLOTS, formatBuilder, mixPicturePath } from '../src/formatBuilder';
import type { FormatView } from '../src/formatBuilderTypes';
import type { MixAsk } from '../src/formatMixRequests';
import { JobStore } from '../src/jobs';
import { HOST, get, post, read, stubEngine } from './support';

const NOW = new Date('2026-11-24T12:00:00Z');
const A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const PATH = '/api/format/formats';

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-format-bible-'));
  mkdirSync(join(folder, 'formats'));
  writeFileSync(join(folder, 'formats', 'abcdefghijk.png'), Buffer.from([0x89, 0x50]));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

const palette: IngredientDraft = {
  layer: 'visual',
  name: 'Palette',
  source: 'teardown',
  sourceKey: 'v:palette',
  sourceLabel: 'Teardown of “Flight”',
  centerChannelId: null,
  channelIds: [A],
  details: { section: 'palette', palette: [{ hex: '#0A0B0E', share: 0.6 }] },
  evidence: {
    score: null,
    scoredVideos: 0,
    videos: 1,
    channels: 1,
    measured: [{ label: '#0A0B0E', value: 60, unit: '% of runtime', method: 'k-means' }],
  },
  media: [
    { kind: 'image', file: 'abcdefghijk.png' },
    { kind: 'thumbnail', videoId: 'aaaaaaaaaa1' },
  ],
};

const ANSWER = JSON.stringify({
  coreRules: ['One idea a video.'],
  visualSystem: { summary: 'Dark.', roles: [{ hex: '#0a0b0e', role: 'Background' }] },
  typography: [{ role: 'Title', font: 'Inter Tight', weight: 'bold', casing: '', use: '' }],
  masterPrompt: 'Make it.',
});

function setup(answer = ANSWER, gate: Promise<void> = Promise.resolve()) {
  const db = openDatabase(':memory:');
  const shelf = new SqliteIngredientRepo(db);
  const asked: MixAsk[] = [];
  const engine = formatBuilder({
    formats: new SqliteFormatRepo(db),
    shelf,
    now: () => NOW,
    channelTitle: () => null,
    picturePath: mixPicturePath(() => folder),
    askMix: async (ask) => {
      asked.push(ask);
      await gate;
      return { engine: 'claude', text: answer, skipped: [] } as never;
    },
  });
  return { engine, shelf, asked };
}

describe('Write my Format Bible on the engine', () => {
  test('asks about the filled slots and their pictures, then keeps the checked Bible', async () => {
    const { engine, shelf, asked } = setup();
    const item = shelf.add(palette, NOW);
    shelf.add(
      { ...palette, sourceKey: 'other', media: [{ kind: 'thumbnail', videoId: 'bbbbbbbbbb1' }] },
      NOW,
    );
    const made = engine.createFormat('Long-form', 600, A);
    engine.updateFormat(made.id, { slots: { visual: { ingredientId: item.id, note: '' } } });
    const steps: string[] = [];
    const view = await engine.writeBible(made.id, A, undefined, (step) => steps.push(step.step));
    expect(steps).toEqual(['asking', 'checking']);
    expect(asked[0]).toMatchObject({
      purpose: 'bible',
      formatId: made.id,
      channel: A,
      thumbnails: ['aaaaaaaaaa1'],
      pictures: [{ name: `i${item.id}-1.png` }],
    });
    expect(view.bible?.written.visualSystem.roles).toEqual([
      { hex: '#0A0B0E', role: 'Background' },
    ]);
    expect(view.bible?.facts.palette).toEqual([
      { hex: '#0A0B0E', share: 0.6, from: 'Teardown of “Flight”' },
    ]);
    expect(engine.bibleMarkdown(made.id)).toMatchObject({ name: 'Long-form' });
    expect(engine.bibleMarkdown(made.id)?.text).toContain('# Format Bible: Long-form');
    expect(await engine.mixPicture(`i${item.id}-1.png`)).toEqual(new Uint8Array([0x89, 0x50]));
  });

  test('refuses no format, empty slots and an answer that is not a Bible', async () => {
    const noop = () => undefined;
    const { engine, shelf } = setup('nothing');
    await expect(engine.writeBible(99, null, undefined, noop)).rejects.toThrow('no such format');
    const made = engine.createFormat('A', null);
    await expect(engine.writeBible(made.id, null, undefined, noop)).rejects.toThrow(EMPTY_SLOTS);
    const item = shelf.add(palette, NOW);
    engine.updateFormat(made.id, { slots: { visual: { ingredientId: item.id, note: '' } } });
    await expect(engine.writeBible(made.id, null, undefined, noop)).rejects.toThrow(
      /The AI answered, but the answer held no Format Bible/,
    );
    expect(engine.bibleMarkdown(made.id)).toBeNull();
    expect(engine.bibleMarkdown(99)).toBeNull();
    expect(await engine.bibleZip(made.id)).toBeNull();
  });

  test('the zip holds the Bible, its palette, fonts and the slots’ pictures', async () => {
    const { engine, shelf } = setup();
    const item = shelf.add(palette, NOW);
    const made = engine.createFormat('Long-form', 600);
    engine.updateFormat(made.id, { slots: { visual: { ingredientId: item.id, note: '' } } });
    await engine.writeBible(made.id, null, undefined, () => undefined);
    const zip = await engine.bibleZip(made.id);
    const listing = Buffer.from(zip!).toString('latin1');
    for (const name of [
      'format-bible.md',
      'palette.json',
      'palette.png',
      'fonts.txt',
      `images/i${item.id}-1.png`,
    ]) {
      expect(listing).toContain(name);
    }
    rmSync(join(folder, 'formats', 'abcdefghijk.png'));
    // The archive's last record counts its files: four without the picture, five with it.
    const entries = (bytes: Uint8Array) => Buffer.from(bytes).readUInt16LE(bytes.length - 22 + 10);
    expect(entries(zip!)).toBe(5);
    expect(entries((await engine.bibleZip(made.id))!)).toBe(4);
  });
});

describe('the Format Bible routes', () => {
  function appWith(answer = ANSWER, gate?: Promise<void>) {
    const built = setup(answer, gate);
    const app = createApp({
      engine: stubEngine({ formatBuilder: built.engine }),
      jobs: new JobStore<JobOutcome, JobProgress>(),
      allowedHosts: [HOST],
    });
    return { app, ...built };
  }

  test('writes as a job in Working, then downloads the .md and the .zip', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, shelf, engine } = appWith(ANSWER, gate);
    const item = shelf.add(palette, NOW);
    const id = engine.createFormat('Long-form', 600).id;
    engine.updateFormat(id, { slots: { visual: { ingredientId: item.id, note: '' } } });
    expect((await get(app, `${PATH}/${id}/format-bible.md`)).status).toBe(404);
    expect((await post(app, `${PATH}/bible`, { id: 99 })).status).toBe(404);
    expect((await post(app, `${PATH}/bible`, { id, channel: 'bad' })).status).toBe(400);
    const started = await post(app, `${PATH}/bible`, { id, engine: 'claude' });
    expect(started.status).toBe(202);
    expect((await post(app, `${PATH}/suggest`, { id })).status).toBe(409);
    const jobs = await read<{ jobs: { kind: string; title: string }[] }>(
      await get(app, '/api/jobs'),
    );
    expect(jobs.data.jobs).toContainEqual(
      expect.objectContaining({
        kind: 'format-bible',
        title: 'Writing the Format Bible of “Long-form”',
      }),
    );
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const { jobId } = (await read<{ jobId: string }>(started)).data;
    const job = await read<{ status: string; result: FormatView }>(
      await get(app, `/api/jobs/${jobId}`),
    );
    expect(job.data.status).toBe('done');
    expect(job.data.result.bible?.engine).toBe('claude');
    const md = await get(app, `${PATH}/${id}/format-bible.md`);
    expect(md.status).toBe(200);
    expect(md.headers.get('content-type')).toContain('text/markdown');
    expect(md.headers.get('content-disposition')).toContain('format-bible-long-form.md');
    expect(await md.text()).toContain('# Format Bible: Long-form');
    const zip = await get(app, `${PATH}/${id}/format-bible.zip`);
    expect(zip.headers.get('content-type')).toBe('application/zip');
    expect((await get(app, `${PATH}/99/format-bible.zip`)).status).toBe(404);
    const posted = await app(
      new Request(`http://${HOST}${PATH}/${id}/format-bible.md`, {
        method: 'POST',
        headers: { host: HOST },
      }),
    );
    expect(posted.status).toBe(405);
  });
});

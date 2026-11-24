import {
  SqliteFormatRepo,
  SqliteIngredientRepo,
  openDatabase,
  type IngredientDraft,
  type OwnVideoInput,
} from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApp, type JobOutcome, type JobProgress } from '../src/app';
import { formatBuilder } from '../src/formatBuilder';
import type { FormatView } from '../src/formatBuilderTypes';
import { JobStore } from '../src/jobs';
import { HOST, get, post, read, stubEngine } from './support';

const NOW = new Date('2026-11-24T12:00:00Z');
const A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const B = 'UCbbbbbbbbbbbbbbbbbbbbbb';

const title: IngredientDraft = {
  layer: 'title',
  name: 'Why [thing] failed',
  source: 'formula',
  sourceKey: 'f1',
  sourceLabel: 'Title formula',
  centerChannelId: A,
  channelIds: [A, B],
  details: { formula: 'Why [thing] failed' },
  evidence: { score: 4, scoredVideos: 2, videos: 3, channels: 2, measured: [] },
  media: [],
};

function setup(own: readonly OwnVideoInput[] = []) {
  const db = openDatabase(':memory:');
  const shelf = new SqliteIngredientRepo(db);
  const asked: string[] = [];
  const engine = formatBuilder({
    formats: new SqliteFormatRepo(db),
    shelf,
    now: () => NOW,
    channelTitle: () => null,
    picturePath: () => null,
    askMix: async () => ({ engine: 'claude', text: '', skipped: [] }) as never,
    ownVideos: (channel) => {
      asked.push(channel);
      return own;
    },
  });
  return { engine, shelf, asked };
}

describe('the active format of a channel', () => {
  test('is set, shown on the list, planned and cleared', () => {
    const { engine, shelf } = setup();
    const item = shelf.add(title, NOW);
    const long = engine.createFormat('Long-form', 600, A);
    const short = engine.createFormat('Shorts', 45, A);
    engine.updateFormat(long.id, { slots: { title: { ingredientId: item.id, note: '' } } });
    expect(engine.activePlan(A)).toBeNull();
    expect(engine.setActive(A, long.id)).toBe(true);
    expect(engine.listFormats(A).map((one) => [one.name, one.active])).toEqual([
      ['Shorts', false],
      ['Long-form', true],
    ]);
    expect(engine.activePlan(A)?.titleFormulas[0]?.formula).toBe('Why [thing] failed');
    expect(engine.setActive(A, 99)).toBe(false);
    expect(engine.setActive(A, short.id)).toBe(true);
    expect(engine.activePlan(A)?.format.name).toBe('Shorts');
    expect(engine.setActive(A, null)).toBe(true);
    expect(engine.activePlan(A)).toBeNull();
  });

  test('your videos against it are counted in code', () => {
    const { engine, shelf, asked } = setup([
      { videoId: 'v1', title: 'Why Kodak failed', score: 3, measured: null },
      { videoId: 'v2', title: 'A day in Rome', score: 1, measured: null },
    ]);
    const item = shelf.add(title, NOW);
    expect(engine.followed(A)).toBeNull();
    const long = engine.createFormat('Long-form', 600, A);
    engine.updateFormat(long.id, { slots: { title: { ingredientId: item.id, note: '' } } });
    engine.setActive(A, long.id);
    const followed = engine.followed(A);
    expect(followed?.format).toEqual({ id: long.id, name: 'Long-form' });
    expect(followed?.report.slots[0]).toMatchObject({
      layer: 'title',
      followed: 1,
      not: 1,
      medianScoreFollowed: 3,
      medianScoreNot: 1,
    });
    expect(asked).toEqual([A]);
  });
});

describe('the active format routes', () => {
  function appWith() {
    const built = setup([{ videoId: 'v1', title: 'Why Kodak failed', score: 2, measured: null }]);
    const app = createApp({
      engine: stubEngine({ formatBuilder: built.engine }),
      jobs: new JobStore<JobOutcome, JobProgress>(),
      allowedHosts: [HOST],
    });
    return { app, ...built };
  }

  test('set and clear the active format; read your videos against it', async () => {
    const { app, engine, shelf } = appWith();
    const item = shelf.add(title, NOW);
    const id = engine.createFormat('Long-form', 600, A).id;
    engine.updateFormat(id, { slots: { title: { ingredientId: item.id, note: '' } } });
    expect((await get(app, `/api/format/followed?channel=${A}`)).status).toBe(404);
    expect((await post(app, '/api/format/active', { channel: A, id: 99 })).status).toBe(404);
    expect((await post(app, '/api/format/active', { channel: 'bad', id })).status).toBe(400);
    const set = await read<{ formats: FormatView[] }>(
      await post(app, '/api/format/active', { channel: A, id }),
    );
    expect(set.data.formats[0]?.active).toBe(true);
    const followed = await read<{ format: { name: string }; report: { videos: number } }>(
      await get(app, `/api/format/followed?channel=${A}`),
    );
    expect(followed.data).toMatchObject({ format: { name: 'Long-form' }, report: { videos: 1 } });
    expect((await get(app, '/api/format/followed?channel=bad')).status).toBe(400);
    const cleared = await read<{ formats: FormatView[] }>(
      await post(app, '/api/format/active', { channel: A, id: null }),
    );
    expect(cleared.data.formats[0]?.active).toBe(false);
    expect((await get(app, '/api/format/active')).status).toBe(405);
  });
});

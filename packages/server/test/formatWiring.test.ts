import { SqliteChannelRepo, SqliteVideoRepo, openDatabase } from '@jgtube/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createEngine, type RunningEngine } from '../src/engine';

const NOW = new Date('2026-11-23T12:00:00Z');
const CHANNEL = `UC${'F'.repeat(22)}`;
const VIDEO = 'FFFFFFFFF01';

let folder: string;
let engine: RunningEngine | null = null;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-format-wiring-'));
});
afterEach(async () => {
  await engine?.shutdown();
  rmSync(folder, { recursive: true, force: true });
});

test('the engine’s shelf reads its sources from the store it opened', () => {
  const dbPath = join(folder, 'store.db');
  const db = openDatabase(dbPath);
  new SqliteChannelRepo(db).upsert(
    {
      id: CHANNEL,
      title: 'Fox',
      handle: null,
      subscribers: 5,
      subscribersHidden: false,
      videoCount: 1,
    },
    NOW,
  );
  new SqliteVideoRepo(db).upsertMany(
    [
      {
        id: VIDEO,
        channelId: CHANNEL,
        title: 'One video',
        views: 500,
        durationSeconds: 300,
        published: { date: NOW, precision: 'day', raw: 'x' },
      },
    ],
    NOW,
  );
  db.close();
  engine = createEngine(
    { dbPath, region: 'US', downloadsPath: join(folder, 'downloads') },
    { now: () => NOW, createSource: async () => ({}) as never, programEnv: { PATH: '' } },
  );
  const { formats } = engine;
  expect(formats.addIngredient({ kind: 'link', videoId: VIDEO })).toMatchObject({
    added: { source: 'link', sourceLabel: 'Your link · Fox' },
  });
  const sources = [
    { kind: 'transfer-idea', key: 'none' },
    { kind: 'niche', channelId: CHANNEL },
    { kind: 'formula', center: CHANNEL, id: 1, windowDays: 90 },
    { kind: 'hook', center: CHANNEL, videoId: VIDEO },
    { kind: 'breakdown-part', channelId: CHANNEL, part: 'titles', layer: null },
    { kind: 'teardown', videoId: VIDEO, section: 'palette', index: 0 },
  ] as const;
  for (const source of sources) {
    expect(formats.addIngredient(source), source.kind).toMatchObject({ status: 404 });
  }
  expect(formats.listIngredients()).toHaveLength(1);
  expect(formats.imagesFolder()).toBe(join(folder, 'downloads', 'formats'));
});

import {
  SqliteChannelRepo,
  SqliteIngredientRepo,
  SqliteVideoRepo,
  openDatabase,
  type Ingredient,
} from '@jgtube/core';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp, type JobOutcome, type JobProgress } from '../src/app';
import { formatEngine, storedVideoFacts } from '../src/formatEngine';
import { FORMAT_IMAGES_PATH, MAX_IMAGE_BYTES, imageKindOf } from '../src/formatRoutes';
import type { FormatEngine } from '../src/formatTypes';
import { JobStore } from '../src/jobs';
import { CENTER, OTHER, VIDEO, sourcesWith } from './formatFixtures';
import { HOST, get, post, read, stubEngine, UNUSED_FORMATS } from './support';

const NOW = new Date('2026-11-23T12:00:00Z');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-format-'));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function appWith(formats?: Partial<FormatEngine>) {
  const engine =
    formats === undefined
      ? formatEngine({
          repo: new SqliteIngredientRepo(openDatabase(':memory:')),
          now: () => NOW,
          sources: sourcesWith(),
          imagesFolder: () => folder,
        })
      : { ...UNUSED_FORMATS, ...formats };
  return createApp({
    engine: stubEngine({ formats: engine }),
    jobs: new JobStore<JobOutcome, JobProgress>(),
    allowedHosts: [HOST],
  });
}

const put = (app: ReturnType<typeof appWith>, body: Uint8Array, headers = {}) =>
  app(
    new Request(`http://${HOST}${FORMAT_IMAGES_PATH}`, {
      method: 'PUT',
      headers: { host: HOST, ...headers },
      body: Buffer.from(body),
    }),
  );

describe('the shelf routes', () => {
  test('adds from a source, lists, notes and takes off', async () => {
    const app = appWith();
    const added = await post(app, '/api/format/ingredients', { kind: 'niche', channelId: OTHER });
    expect(added.status).toBe(201);
    const { data } = await read<Ingredient>(added);
    expect(data).toMatchObject({ source: 'niche', proven: false });
    const note = await post(app, '/api/format/ingredients/note', { id: data.id, note: 'mine' });
    expect(note.status).toBe(200);
    const list = await read<{ ingredients: Ingredient[] }>(
      await get(app, '/api/format/ingredients'),
    );
    expect(list.data.ingredients.map((item) => item.note)).toEqual(['mine']);
    expect((await post(app, '/api/format/ingredients/remove', { id: data.id })).status).toBe(200);
    expect((await post(app, '/api/format/ingredients/remove', { id: data.id })).status).toBe(404);
    expect(
      (await post(app, '/api/format/ingredients/note', { id: data.id, note: 'x' })).status,
    ).toBe(404);
  });

  test('a pasted link is read for its video id; anything else is refused', async () => {
    const app = appWith();
    const link = await post(app, '/api/format/ingredients', {
      kind: 'link',
      url: `https://youtu.be/${VIDEO}`,
    });
    expect((await read<Ingredient>(link)).data.source).toBe('link');
    const bad = await post(app, '/api/format/ingredients', { kind: 'link', url: 'not a link' });
    expect(bad.status).toBe(400);
    expect((await read(bad)).error).toMatch(/YouTube video link/);
  });

  test('refuses a body that names nothing, and answers 404 for a missing source', async () => {
    const app = appWith();
    expect((await post(app, '/api/format/ingredients', { kind: 'web' })).status).toBe(400);
    expect((await post(app, '/api/format/ingredients', 'not json')).status).toBe(400);
    expect((await post(app, '/api/format/ingredients/note', { id: 'x' })).status).toBe(400);
    expect((await post(app, '/api/format/ingredients/remove', {})).status).toBe(400);
    const missing = await post(app, '/api/format/ingredients', {
      kind: 'hook',
      center: CENTER,
      videoId: 'zzzzzzzzzzz',
    });
    expect(missing.status).toBe(404);
  });

  test('answers the wrong method plainly and leaves other paths alone', async () => {
    const app = appWith({});
    const wrong = (path: string, method: string) =>
      app(new Request(`http://${HOST}${path}`, { method, headers: { host: HOST } }));
    expect((await read(await wrong('/api/format/ingredients', 'DELETE'))).error).toBe(
      'Use GET or POST',
    );
    expect((await read(await wrong('/api/format/ingredients/note', 'GET'))).error).toBe('Use POST');
    expect((await wrong(FORMAT_IMAGES_PATH, 'GET')).status).toBe(405);
    expect((await wrong('/api/format/images/abcdefghijk.png', 'POST')).status).toBe(405);
    expect((await wrong('/api/format/other', 'GET')).status).toBe(404);
  });
});

describe('the owner’s pictures', () => {
  test('a PNG is saved under a new name and read back', async () => {
    const app = appWith();
    const saved = await put(app, PNG);
    expect(saved.status).toBe(201);
    const { data } = await read<{ file: string }>(saved);
    expect(data.file).toMatch(/^[\w-]{11}\.png$/);
    expect(readdirSync(folder)).toEqual([data.file]);
    const back = await get(app, `/api/format/images/${data.file}`);
    expect(back.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(PNG);
    expect((await get(app, '/api/format/images/abcdefghijk.png')).status).toBe(404);
  });

  test('refuses what is not a picture, too large, from another site, or empty', async () => {
    const app = appWith();
    expect((await put(app, new Uint8Array([1, 2, 3]))).status).toBe(415);
    expect((await put(app, PNG, { 'content-length': String(MAX_IMAGE_BYTES + 1) })).status).toBe(
      413,
    );
    expect((await put(app, PNG, { origin: 'https://evil.example' })).status).toBe(403);
    const big = new Uint8Array(MAX_IMAGE_BYTES + 10);
    big.set(PNG);
    expect((await put(app, big)).status).toBe(413);
    const empty = await app(
      new Request(`http://${HOST}${FORMAT_IMAGES_PATH}`, {
        method: 'PUT',
        headers: { host: HOST },
      }),
    );
    expect(empty.status).toBe(400);
    expect(readdirSync(folder)).toEqual([]);
  });

  test('says so when there is no folder to keep pictures in', async () => {
    const app = appWith({
      imagesFolder: () => {
        throw new Error('in memory');
      },
    });
    expect((await put(app, PNG)).status).toBe(500);
  });

  test('tells PNG, JPEG and WebP by their first bytes', () => {
    expect(imageKindOf(PNG)).toBe('png');
    expect(imageKindOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBP');
    expect(imageKindOf(webp)).toBe('webp');
    expect(imageKindOf(new TextEncoder().encode('RIFF\0\0\0\0WAVE'))).toBeNull();
  });
});

describe('storedVideoFacts', () => {
  test('reads a stored video with its channel and score; null for one not stored', () => {
    const db = openDatabase(':memory:');
    const channels = new SqliteChannelRepo(db);
    channels.upsert(
      {
        id: OTHER,
        title: 'Alpha',
        handle: null,
        subscribers: 10,
        subscribersHidden: false,
        videoCount: 5,
      },
      NOW,
    );
    const videos = new SqliteVideoRepo(db);
    videos.upsertMany(
      [1, 2, 3, 4, 5].map((n) => ({
        id: `aaaaaaaaaa${n}`,
        channelId: OTHER,
        title: `Video ${n}`,
        views: n === 1 ? 90_000 : 1000,
        durationSeconds: 600,
        published: {
          date: new Date(NOW.getTime() - n * 10 * 86_400_000),
          precision: 'day',
          raw: 'x',
        },
      })),
      NOW,
    );
    const facts = storedVideoFacts(db, channels, () => NOW);
    expect(facts(VIDEO)).toMatchObject({
      channelTitle: 'Alpha',
      views: 90_000,
      durationSeconds: 600,
    });
    expect(facts(VIDEO)?.score).toBeGreaterThan(1);
    expect(facts('zzzzzzzzzzz')).toBeNull();
    const nameless = storedVideoFacts(db, { findById: () => null }, () => NOW);
    expect(nameless(VIDEO)?.channelTitle).toBe(OTHER);
  });
});

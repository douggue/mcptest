import type { Ingredient, IngredientEvidence } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createFormatApi } from '../src/lib/formatApi';
import {
  ALL,
  MAX_IMAGE_BYTES,
  evidenceLine,
  imageProblem,
  isReading,
  layerCounts,
  measuredText,
  mediaUrl,
  paletteOf,
  scoreText,
  shelfItems,
  sourcesOn,
} from '../src/lib/formatShelf';

const evidence = (parts: Partial<IngredientEvidence> = {}): IngredientEvidence => ({
  score: null,
  scoredVideos: 0,
  videos: null,
  channels: null,
  measured: [],
  ...parts,
});

const item = (id: number, parts: Partial<Ingredient> = {}): Ingredient => ({
  id,
  layer: 'title',
  name: `Item ${id}`,
  source: 'formula',
  sourceKey: String(id),
  sourceLabel: 'Title formula',
  centerChannelId: null,
  channelIds: [],
  details: {},
  evidence: evidence(),
  media: [],
  note: '',
  addedAt: `2026-11-2${id}T00:00:00.000Z`,
  proven: false,
  ...parts,
});

const SHELF = [
  item(1, { evidence: evidence({ videos: 1, channels: 1, score: 9, scoredVideos: 1 }) }),
  item(2, {
    layer: 'hook',
    source: 'hook',
    name: 'Cold open',
    evidence: evidence({ videos: 3, channels: 2 }),
    proven: true,
  }),
  item(3, { layer: 'sound', source: 'note', name: 'Quiet bed', note: 'low drone' }),
];

describe('shelfItems', () => {
  test('orders by evidence, proven first, without touching the list given', () => {
    const before = SHELF.map((entry) => entry.id);
    expect(shelfItems(SHELF, ALL).map((entry) => entry.id)).toEqual([2, 1, 3]);
    expect(SHELF.map((entry) => entry.id)).toEqual(before);
  });

  test('orders by when it was added, newest first', () => {
    const newest = shelfItems(SHELF, { ...ALL, sort: 'newest' });
    expect(newest.map((entry) => entry.id)).toEqual([3, 2, 1]);
    const tie = [item(4, { addedAt: 'x' }), item(5, { addedAt: 'x' })];
    expect(shelfItems(tie, { ...ALL, sort: 'newest' }).map((entry) => entry.id)).toEqual([5, 4]);
    expect(shelfItems(tie, ALL).map((entry) => entry.id)).toEqual([5, 4]);
  });

  test('filters by layer, source and every word searched, in name, note or source', () => {
    expect(shelfItems(SHELF, { ...ALL, layer: 'hook' }).map((entry) => entry.id)).toEqual([2]);
    expect(shelfItems(SHELF, { ...ALL, source: 'note' }).map((entry) => entry.id)).toEqual([3]);
    expect(shelfItems(SHELF, { ...ALL, query: 'LOW  quiet' }).map((entry) => entry.id)).toEqual([
      3,
    ]);
    expect(shelfItems(SHELF, { ...ALL, query: 'visual' })).toEqual([]);
  });
});

describe('counts and chips', () => {
  test('counts each layer and lists the sources there are', () => {
    expect(layerCounts(SHELF)).toMatchObject({ title: 1, hook: 1, sound: 1, visual: 0 });
    expect(sourcesOn(SHELF)).toEqual(['formula', 'hook', 'note']);
  });
});

describe('evidenceLine', () => {
  test('says what was counted, and only that', () => {
    expect(
      evidenceLine(evidence({ videos: 4, channels: 3, score: 2.44, scoredVideos: 4 }), true),
    ).toBe('Proven · 4 videos · 3 channels · 2.4× average of 4');
    expect(
      evidenceLine(evidence({ videos: 1, channels: 1, score: 12, scoredVideos: 1 }), false),
    ).toBe("1 video · 1 channel · 12× its channel's usual");
    expect(evidenceLine(evidence(), false)).toBe('Nothing counted: your own');
  });

  test('writes scores the app’s way', () => {
    expect(scoreText(3.04)).toBe('3.0×');
    expect(scoreText(25.6)).toBe('26×');
  });
});

describe('measuredText', () => {
  test('writes the number with its unit', () => {
    const number = (value: number, unit: string) => ({ label: 'x', value, unit, method: 'm' });
    expect(measuredText(number(2.54, 'a minute'))).toBe('2.5 a minute');
    expect(measuredText(number(70, '% of runtime'))).toBe('70% of runtime');
    expect(measuredText(number(12345.6, 'views'))).toBe('12,346 views');
    expect(measuredText(number(3, ''))).toBe('3');
  });
});

describe('media and details', () => {
  test('each picture is read from where it lives; a quote has no picture', () => {
    expect(mediaUrl({ kind: 'thumbnail', videoId: 'abcdefghijk' })).toBe(
      'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg',
    );
    expect(mediaUrl({ kind: 'strip', videoId: 'abcdefghijk', file: 's-001.jpg' })).toBe(
      '/api/video-teardowns/abcdefghijk/images/s-001.jpg',
    );
    expect(mediaUrl({ kind: 'image', file: 'abcdefghijk.png' })).toBe(
      '/api/format/images/abcdefghijk.png',
    );
    expect(mediaUrl({ kind: 'quote', text: 'x', videoId: null })).toBeNull();
  });

  test('reads a measured palette and leaves out anything that is not one', () => {
    const palette = [{ hex: '#0A0B0E', share: 0.7 }, { hex: 'red', share: 1 }, null, 'x'];
    expect(paletteOf(item(1, { details: { palette } }))).toEqual([{ hex: '#0A0B0E', share: 0.7 }]);
    expect(paletteOf(item(1))).toEqual([]);
  });

  test('takes a PNG, JPEG or WebP picture of up to 8 MB', () => {
    expect(imageProblem({ type: 'image/png', size: 10 })).toBeNull();
    expect(imageProblem({ type: 'image/gif', size: 10 })).toMatch(/PNG/);
    expect(imageProblem({ type: 'image/webp', size: 0 })).toMatch(/empty/);
    expect(imageProblem({ type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 })).toMatch(/8 MB/);
  });

  test('tells an engine’s reading from what was counted', () => {
    expect(isReading(item(1, { details: { reading: 'text' } }))).toBe(true);
    expect(isReading(item(1, { details: { reading: null } }))).toBe(false);
    expect(isReading(item(1))).toBe(false);
  });
});

describe('createFormatApi', () => {
  test('lists, adds, notes and removes through the server', async () => {
    const asked: [string, RequestInit | undefined][] = [];
    const reply = (data: unknown) =>
      new Response(JSON.stringify({ success: true, data, error: null, meta: null }));
    const api = createFormatApi(async (path, init) => {
      asked.push([path, init]);
      return path === '/api/format/ingredients' && !init
        ? reply({ ingredients: [item(1)] })
        : reply(item(2));
    });
    expect(await api.ingredients()).toHaveLength(1);
    expect((await api.add({ kind: 'niche', channelId: 'x' })).id).toBe(2);
    await api.setNote(2, 'n');
    await api.remove(2);
    expect(asked.map(([path]) => path)).toEqual([
      '/api/format/ingredients',
      '/api/format/ingredients',
      '/api/format/ingredients/note',
      '/api/format/ingredients/remove',
    ]);
    expect(JSON.parse(String(asked[2]?.[1]?.body))).toEqual({ id: 2, note: 'n' });
  });
});

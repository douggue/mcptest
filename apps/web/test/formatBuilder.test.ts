import type { FormatChecks, Ingredient } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import {
  choicesFor,
  createFormatBuilderApi,
  filledCount,
  lengthText,
  originalityLine,
  secondsFrom,
  slotWarnings,
} from '../src/lib/formatBuilder';

const checks = (parts: Partial<FormatChecks> = {}): FormatChecks => ({
  clashes: [],
  unproven: [],
  originality: {
    filled: 0,
    channelId: null,
    fromChannel: 0,
    share: 0,
    layers: [],
    copiesOneChannel: false,
  },
  ...parts,
});

const item = (id: number, parts: Partial<Ingredient> = {}): Ingredient => ({
  id,
  layer: 'title',
  name: `Item ${id}`,
  source: 'note',
  sourceKey: String(id),
  sourceLabel: 'x',
  centerChannelId: null,
  channelIds: [],
  details: {},
  evidence: { score: null, scoredVideos: 0, videos: null, channels: null, measured: [] },
  media: [],
  note: '',
  addedAt: 'x',
  proven: false,
  ...parts,
});

describe('slot warnings', () => {
  test('put each clash, unproven slot and copied slot beside its layer', () => {
    const warnings = slotWarnings({
      topChannelTitle: 'Alpha',
      checks: checks({
        clashes: [{ kind: 'pace-motion', layers: ['pacing', 'motion'], says: 'Paces differ.' }],
        unproven: ['pacing'],
        originality: {
          filled: 4,
          channelId: 'UC1',
          fromChannel: 3,
          share: 0.75,
          layers: ['pacing', 'title', 'hook'],
          copiesOneChannel: true,
        },
      }),
    });
    expect(warnings.pacing?.map((w) => w.kind)).toEqual(['clash', 'unproven', 'copies']);
    expect(warnings.motion).toEqual([{ kind: 'clash', text: 'Paces differ.' }]);
    expect(warnings.title).toEqual([{ kind: 'copies', text: 'From Alpha.' }]);
    expect(warnings.sound).toBeUndefined();
    expect(slotWarnings({ topChannelTitle: null, checks: checks() })).toEqual({});
  });

  test('the originality line says when a format copies one channel, with its counts', () => {
    const originality = {
      filled: 4,
      channelId: 'UC1',
      fromChannel: 3,
      share: 0.75,
      layers: [],
      copiesOneChannel: true,
    } as const;
    expect(originalityLine({ topChannelTitle: 'Alpha', checks: checks({ originality }) })).toBe(
      'This copies one channel: 3 of 4 filled slots (75%) come from Alpha. Mix in pieces from others.',
    );
    expect(
      originalityLine({
        topChannelTitle: null,
        checks: checks({
          originality: { ...originality, fromChannel: 2, share: 0.5, copiesOneChannel: false },
        }),
      }),
    ).toBe('2 of 4 filled slots (50%) come from one channel: a mix, not a copy.');
    expect(originalityLine({ topChannelTitle: null, checks: checks() })).toBeNull();
    const warned = slotWarnings({
      topChannelTitle: null,
      checks: checks({ originality: { ...originality, layers: ['sound'] } }),
    });
    expect(warned.sound?.[0]?.text).toBe('From one channel.');
  });
});

test('choicesFor lists a layer’s ingredients, proven first then newest', () => {
  const shelf = [item(1), item(2, { proven: true }), item(3), item(4, { layer: 'hook' })];
  expect(choicesFor(shelf, 'title').map((one) => one.id)).toEqual([2, 3, 1]);
  expect(filledCount({ title: { ingredientId: 1, note: '' }, hook: undefined })).toBe(1);
});

test('lengths read and typed', () => {
  expect(lengthText(null)).toBe('No length set');
  expect(lengthText(45)).toBe('45 s');
  expect(lengthText(600)).toBe('10 min');
  expect(lengthText(3600)).toBe('1 h');
  expect(lengthText(3900)).toBe('1 h 5 min');
  expect(secondsFrom(' ')).toBeNull();
  expect(secondsFrom('0.75')).toBe(45);
  expect(secondsFrom('x')).toBe('bad');
  expect(secondsFrom('-1')).toBe('bad');
});

describe('the builder API', () => {
  test('sends each change to its path and reads the envelope', async () => {
    const sent: Array<[string, unknown]> = [];
    const view = { id: 1, name: 'A' };
    const api = createFormatBuilderApi(async (input, init) => {
      sent.push([String(input), init?.body === undefined ? null : JSON.parse(String(init.body))]);
      const data = String(input).endsWith('/suggest')
        ? { jobId: 'j1' }
        : String(input).endsWith('/remove')
          ? { id: 1 }
          : init?.method === 'POST'
            ? view
            : { formats: [view] };
      return new Response(JSON.stringify({ success: true, data, error: null, meta: null }));
    });
    expect(await api.list()).toEqual([view]);
    expect(await api.create('A', 60)).toEqual(view);
    await api.update(1, { name: 'B' });
    await api.duplicate(1);
    await api.remove(1);
    expect(await api.suggest(1, 'UC1', null)).toBe('j1');
    await api.suggest(1, null, 'claude');
    expect(sent.map(([path]) => path)).toEqual([
      '/api/format/formats',
      '/api/format/formats',
      '/api/format/formats/update',
      '/api/format/formats/duplicate',
      '/api/format/formats/remove',
      '/api/format/formats/suggest',
      '/api/format/formats/suggest',
    ]);
    expect(sent[2]?.[1]).toEqual({ id: 1, name: 'B' });
    expect(sent[5]?.[1]).toEqual({ id: 1, channel: 'UC1' });
    expect(sent[6]?.[1]).toEqual({ id: 1, channel: null, engine: 'claude' });
  });
});

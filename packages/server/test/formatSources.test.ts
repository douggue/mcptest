import { openDatabase, SqliteIngredientRepo } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { formatEngine } from '../src/formatEngine';
import { resolveIngredient } from '../src/formatSources';
import type { IngredientRequest } from '../src/formatTypes';
import { CENTER, OTHER, VIDEO, sourcesWith } from './formatFixtures';

const NOW = new Date('2026-11-23T12:00:00Z');

const draftOf = (request: IngredientRequest, sources = sourcesWith()) => {
  const resolved = resolveIngredient(sources, request);
  if ('missing' in resolved) throw new Error(resolved.missing);
  return resolved;
};
const missingOf = (request: IngredientRequest, sources = sourcesWith()) => {
  const resolved = resolveIngredient(sources, request);
  return 'missing' in resolved ? resolved.missing : null;
};

describe('resolveIngredient', () => {
  test('reads each kind of source from the store', () => {
    expect(draftOf({ kind: 'formula', center: CENTER, id: 3, windowDays: 90 })).toMatchObject({
      source: 'formula',
      layer: 'title',
    });
    expect(draftOf({ kind: 'transfer-format', key: 'format' }).source).toBe('transfer-format');
    expect(draftOf({ kind: 'transfer-idea', key: 'idea' }).source).toBe('transfer-idea');
    expect(draftOf({ kind: 'hook', center: CENTER, videoId: VIDEO }).layer).toBe('hook');
    expect(
      draftOf({ kind: 'video', use: 'thumbnail', videoId: VIDEO, center: CENTER }),
    ).toMatchObject({ layer: 'thumbnail', evidence: { score: 9 } });
    expect(draftOf({ kind: 'niche', channelId: OTHER }).source).toBe('niche');
    expect(draftOf({ kind: 'link', videoId: VIDEO }).evidence.score).toBe(9);
    expect(draftOf({ kind: 'link', videoId: 'zzzzzzzzzzz' }).evidence.videos).toBeNull();
  });

  test('a breakdown part takes the layer the owner picked, or its own', () => {
    const own = { kind: 'breakdown-part', channelId: OTHER, part: 'scripts', layer: null } as const;
    expect(draftOf(own)).toMatchObject({ layer: 'structure', name: 'Scripts of Alpha' });
    expect(draftOf({ ...own, layer: 'pacing' }).layer).toBe('pacing');
    const unnamed = sourcesWith({ channelTitle: () => null });
    expect(draftOf(own, unnamed).name).toBe(`Scripts of ${OTHER}`);
  });

  test('a breakdown part carries the channel’s measured medians for its layer', () => {
    const group = {
      videos: 4,
      measured: 3,
      medianCutsPerMinute: 9.5,
      medianShotSeconds: null,
      medianWordsPerMinute: 158,
      medianAnimationsPerMinute: 2,
    };
    const facts = {
      winners: group,
      palette: { items: [{ hex: '#0A0B0E', share: 0.5 }], method: 'k-means' },
      methods: { pace: 'ffmpeg', words: 'captions', transitions: 'frames' },
    };
    const measured = sourcesWith({ channelMeasurements: () => facts as never });
    const picture = {
      kind: 'breakdown-part',
      channelId: OTHER,
      part: 'picture',
      layer: null,
    } as const;
    const draft = draftOf(picture, measured);
    expect(draft.details['palette']).toEqual([{ hex: '#0A0B0E', share: 0.5 }]);
    expect(draft.evidence.measured.map((one) => one.label)).toEqual([
      '#0A0B0E',
      'Animations a minute',
    ]);
    const paced = draftOf({ ...picture, part: 'scripts', layer: 'pacing' }, measured);
    expect(paced.evidence.measured.map((one) => one.label)).toEqual([
      'Cuts a minute',
      'Words a minute',
    ]);
    expect(draftOf(picture).evidence.measured).toEqual([]);
  });

  test('the owner’s own note, picture and clip', () => {
    expect(
      draftOf({ kind: 'note', layer: 'sound', name: 'Quiet', text: 'Low music' }).details,
    ).toEqual({ text: 'Low music' });
    const image = {
      kind: 'image',
      layer: 'visual',
      name: 'Mood',
      file: 'abcdefghijk.png',
    } as const;
    expect(draftOf(image).media).toHaveLength(1);
    expect(draftOf({ ...image, kind: 'clip', file: 'abcdefghijk' }).source).toBe('clip');
  });

  test('says what is missing rather than making anything up', () => {
    const none = sourcesWith({
      listFormulas: () => null,
      hookLibrary: () => null,
      teardownReport: () => null,
      findBreakdownPart: (channelId, part) => ({
        channelId,
        part,
        writtenAt: NOW,
        written: false,
        reason: 'limit',
      }),
    });
    expect(missingOf({ kind: 'formula', center: CENTER, id: 3, windowDays: 90 }, none)).toMatch(
      /formula/,
    );
    expect(missingOf({ kind: 'formula', center: CENTER, id: 4, windowDays: 90 })).toMatch(
      /formula/,
    );
    expect(missingOf({ kind: 'transfer-format', key: 'nope' })).toMatch(/format/);
    expect(missingOf({ kind: 'transfer-idea', key: 'nope' })).toMatch(/idea/);
    expect(missingOf({ kind: 'hook', center: CENTER, videoId: VIDEO }, none)).toMatch(/hook/);
    expect(
      missingOf({ kind: 'video', use: 'video', videoId: 'zzzzzzzzzzz', center: null }),
    ).toMatch(/stored/);
    expect(missingOf({ kind: 'niche', channelId: CENTER })).toMatch(/niches/);
    const part = { kind: 'breakdown-part', channelId: OTHER, part: 'titles', layer: null } as const;
    expect(missingOf(part, none)).toMatch(/written/);
    expect(missingOf({ kind: 'teardown', videoId: VIDEO, section: 'metrics', index: 0 })).toMatch(
      /teardown/,
    );
    expect(
      missingOf({ kind: 'teardown', videoId: VIDEO, section: 'metrics', index: 0 }, none),
    ).toMatch(/teardown/);
  });
});

describe('formatEngine', () => {
  const engineWith = (sources = sourcesWith()) =>
    formatEngine({
      repo: new SqliteIngredientRepo(openDatabase(':memory:')),
      now: () => NOW,
      sources,
      imagesFolder: () => '/tmp/x',
    });

  test('adds, lists, notes and removes', () => {
    const engine = engineWith();
    const outcome = engine.addIngredient({ kind: 'niche', channelId: OTHER });
    if (!('added' in outcome)) throw new Error(outcome.problem);
    expect(engine.listIngredients()).toHaveLength(1);
    expect(engine.setIngredientNote(outcome.added.id, 'keep')).toBe(true);
    expect(engine.listIngredients()[0]?.note).toBe('keep');
    expect(engine.removeIngredient(outcome.added.id)).toBe(true);
    expect(engine.imagesFolder()).toBe('/tmp/x');
  });

  test('answers 404 for a missing source and 400 for one that breaks a rule', () => {
    const engine = engineWith();
    expect(engine.addIngredient({ kind: 'niche', channelId: CENTER })).toMatchObject({
      status: 404,
    });
    expect(
      engine.addIngredient({ kind: 'image', layer: 'visual', name: 'x', file: 'nope' }),
    ).toMatchObject({ status: 400, problem: expect.stringMatching(/picture/) });
    const throwing = engineWith(
      sourcesWith({
        listNiches: () => {
          throw 'store closed';
        },
      }),
    );
    expect(throwing.addIngredient({ kind: 'niche', channelId: OTHER })).toMatchObject({
      status: 400,
      problem: 'store closed',
    });
    const blank = engineWith(sourcesWith({ channelTitle: () => '   ' }));
    expect(
      blank.addIngredient({
        kind: 'breakdown-part',
        channelId: OTHER,
        part: 'master',
        layer: null,
      }),
    ).toMatchObject({ added: expect.anything() });
  });

  test('a draft the store refuses is answered 400', () => {
    const engine = engineWith(
      sourcesWith({
        videoFacts: () => ({
          videoId: VIDEO,
          title: 'x',
          channelId: 'not a channel',
          channelTitle: 'x',
          views: 1,
          durationSeconds: null,
          score: null,
        }),
      }),
    );
    expect(engine.addIngredient({ kind: 'link', videoId: VIDEO })).toMatchObject({
      status: 400,
      problem: expect.stringMatching(/channel/),
    });
  });
});

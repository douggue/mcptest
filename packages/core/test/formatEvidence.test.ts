import { describe, expect, test } from 'vitest';
import {
  PROVEN_MIN_CHANNELS,
  PROVEN_MIN_VIDEOS,
  compareByEvidence,
  draftProblem,
  isProven,
  meanScore,
  noEvidence,
} from '../src/format/evidence';
import type { IngredientDraft, IngredientEvidence } from '../src/format/types';

const evidence = (parts: Partial<IngredientEvidence>): IngredientEvidence => ({
  ...noEvidence(),
  ...parts,
});

const draft = (parts: Partial<IngredientDraft> = {}): IngredientDraft => ({
  layer: 'title',
  name: 'Why [thing] failed',
  source: 'formula',
  sourceKey: 'UCaaaaaaaaaaaaaaaaaaaaaa:90:1',
  sourceLabel: 'Title formula',
  centerChannelId: null,
  channelIds: [],
  details: {},
  evidence: noEvidence(),
  media: [],
  ...parts,
});

describe('isProven', () => {
  test('needs two videos from two channels', () => {
    expect(PROVEN_MIN_VIDEOS).toBe(2);
    expect(PROVEN_MIN_CHANNELS).toBe(2);
    expect(isProven(evidence({ videos: 2, channels: 2 }))).toBe(true);
    expect(isProven(evidence({ videos: 5, channels: 1 }))).toBe(false);
  });

  test('never calls one lucky video proven, however high its score', () => {
    expect(isProven(evidence({ videos: 1, channels: 1, score: 40, scoredVideos: 1 }))).toBe(false);
    expect(isProven(evidence({ videos: null, channels: null }))).toBe(false);
  });
});

describe('compareByEvidence', () => {
  test('puts proven first, then more channels, more videos, a higher score', () => {
    const items = [
      { name: 'lone', evidence: evidence({ videos: 1, channels: 1, score: 30, scoredVideos: 1 }) },
      { name: 'few', evidence: evidence({ videos: 3, channels: 2, score: 2, scoredVideos: 3 }) },
      { name: 'wide', evidence: evidence({ videos: 3, channels: 3, score: 1, scoredVideos: 3 }) },
      { name: 'many', evidence: evidence({ videos: 6, channels: 2, score: 1, scoredVideos: 6 }) },
      { name: 'none', evidence: noEvidence() },
      {
        name: 'scored',
        evidence: evidence({ videos: 1, channels: 1, score: 50, scoredVideos: 1 }),
      },
    ];
    expect([...items].sort(compareByEvidence).map((item) => item.name)).toEqual([
      'wide',
      'many',
      'few',
      'scored',
      'lone',
      'none',
    ]);
  });
});

describe('meanScore', () => {
  test('averages the scores there are and counts them', () => {
    expect(meanScore([2, null, 4])).toEqual({ score: 3, scoredVideos: 2 });
    expect(meanScore([null])).toEqual({ score: null, scoredVideos: 0 });
  });
});

describe('draftProblem', () => {
  test('passes a sound draft', () => {
    expect(draftProblem(draft())).toBeNull();
  });

  test('refuses a draft with no name, a long name, or no source key', () => {
    expect(draftProblem(draft({ name: '  ' }))).toMatch(/name/);
    expect(draftProblem(draft({ name: 'x'.repeat(200) }))).toMatch(/name/);
    expect(draftProblem(draft({ sourceKey: '' }))).toMatch(/source/);
  });

  test('refuses an unknown layer or source, or a channel id that is not one', () => {
    expect(draftProblem(draft({ layer: 'colour' as never }))).toMatch(/layer/);
    expect(draftProblem(draft({ source: 'web' as never }))).toMatch(/source/);
    expect(draftProblem(draft({ channelIds: ['nope'] }))).toMatch(/channel/);
    expect(draftProblem(draft({ centerChannelId: 'nope' }))).toMatch(/channel/);
  });

  test('refuses evidence that is not a real count or score', () => {
    expect(draftProblem(draft({ evidence: evidence({ videos: -1 }) }))).toMatch(/evidence/);
    expect(draftProblem(draft({ evidence: evidence({ score: Number.NaN }) }))).toMatch(/evidence/);
    expect(draftProblem(draft({ evidence: evidence({ channels: 1.5 }) }))).toMatch(/evidence/);
    const measured = [{ label: 'x', value: Number.POSITIVE_INFINITY, unit: '', method: 'm' }];
    expect(draftProblem(draft({ evidence: evidence({ measured }) }))).toMatch(/evidence/);
  });
});

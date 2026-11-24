import { describe, expect, test } from 'vitest';
import { checkBible } from '../src/format/bible';
import { bibleFacts } from '../src/format/bibleFacts';
import { followedSlots, type OwnVideoInput } from '../src/format/followed';
import type { Format } from '../src/format/formats';
import { measuredForLayer } from '../src/format/fromBreakdown';
import { formatPlan } from '../src/format/plan';
import { titleFits } from '../src/format/titleFit';
import type { Ingredient } from '../src/format/types';
import type { ChannelFacts } from '../src/teardown/channelFacts';

const A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const NOW = new Date('2026-11-24T10:00:00Z');

const item = (id: number, parts: Partial<Ingredient>): Ingredient => ({
  id,
  layer: 'title',
  name: `Item ${id}`,
  source: 'formula',
  sourceKey: String(id),
  sourceLabel: `Source ${id}`,
  centerChannelId: null,
  channelIds: [A],
  details: {},
  evidence: { score: null, scoredVideos: 0, videos: 1, channels: 1, measured: [] },
  media: [],
  note: '',
  addedAt: NOW.toISOString(),
  proven: false,
  ...parts,
});

const shelf = [
  item(1, {
    details: { formula: 'Why [thing] failed in [year]' },
    evidence: { score: 4.3, scoredVideos: 5, videos: 6, channels: 3, measured: [] },
  }),
  item(2, {
    layer: 'hook',
    name: 'Cold open',
    source: 'hook',
    details: { style: 'Cold open', how: 'Starts in the middle of the scene.' },
    media: [{ kind: 'quote', text: 'In 1962 a plane vanished.', videoId: 'aaaaaaaaaa4' }],
    evidence: {
      score: 6.1,
      scoredVideos: 3,
      videos: 3,
      channels: 2,
      measured: [
        { label: 'Words in the first minute', value: 150, unit: 'words', method: 'm' },
        { label: 'Pace of the opening', value: 150, unit: 'words a minute', method: 'm' },
      ],
    },
  }),
  item(3, {
    layer: 'pacing',
    evidence: {
      score: null,
      scoredVideos: 0,
      videos: 1,
      channels: 1,
      measured: [
        { label: 'Cuts a minute', value: 10, unit: 'a minute', method: 'ffmpeg' },
        { label: 'Words a minute', value: 160, unit: 'words a minute', method: 'captions' },
      ],
    },
  }),
  item(4, {
    layer: 'visual',
    details: {
      palette: [
        { hex: '#101010', share: 0.6 },
        { hex: '#E63946', share: 0.2 },
      ],
    },
  }),
  item(5, { layer: 'thumbnail', name: 'Object on dark' }),
];

const format: Format = {
  id: 9,
  channelId: A,
  name: 'Long-form',
  targetSeconds: 600,
  notes: '',
  slots: {
    title: { ingredientId: 1, note: '' },
    hook: { ingredientId: 2, note: '' },
    pacing: { ingredientId: 3, note: '' },
    visual: { ingredientId: 4, note: '' },
    thumbnail: { ingredientId: 5, note: '' },
  },
  suggestion: null,
  bible: null,
  copiedFrom: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

const withBible = (): Format => {
  const checked = checkBible(
    JSON.stringify({
      coreRules: ['One idea.'],
      visualSystem: { summary: 'Dark ground, red accent.', roles: [] },
      components: [{ name: 'Map pin', purpose: '', build: '' }],
      motion: [{ name: 'Line draws outward', recipe: '' }],
      pacing: ['Hold a map while the scene is set.'],
      hook: [{ beat: 'Cold open', does: 'Mid-scene.' }],
      chapters: [{ beat: 'Setup', does: 'Who and where.' }],
      titleFormulas: [{ formula: 'How [thing] vanished', example: '' }],
      thumbnails: [{ name: 'Object on dark', layout: 'Left object', prompt: 'A plane on black.' }],
      masterPrompt: 'Make it.',
    }),
    bibleFacts(format, shelf),
    'claude',
    NOW,
  );
  if (!checked.ok) throw new Error('fixture');
  return { ...format, bible: checked.bible };
};

describe('the plan of an active format', () => {
  test('without a Bible: the slots and what code measured', () => {
    const plan = formatPlan(format, shelf);
    expect(plan.format).toEqual({ id: 9, name: 'Long-form', targetSeconds: 600, notes: '' });
    expect(plan.titleFormulas).toEqual([
      { formula: 'Why [thing] failed in [year]', from: 'slot', videos: 6, channels: 3, score: 4.3 },
    ]);
    expect(plan.hook).toEqual({
      name: 'Cold open',
      how: 'Starts in the middle of the scene.',
      quote: 'In 1962 a plane vanished.',
      seconds: 60,
      beats: [],
    });
    expect(plan.wordsPerMinute).toBe(160);
    expect(plan.cutsPerMinute).toBe(10);
    expect(plan.palette).toEqual([
      { hex: '#101010', share: 0.6 },
      { hex: '#E63946', share: 0.2 },
    ]);
    expect(plan.thumbnails).toEqual({ slot: 'Object on dark', layouts: [] });
    expect(plan.bible).toBeNull();
    expect(plan.note).toMatch(/measured in code/);
  });

  test('with a Bible: its formulas, beats, rules, style and layouts, as its reading', () => {
    const plan = formatPlan(withBible(), shelf);
    expect(plan.titleFormulas.map((one) => [one.formula, one.from])).toEqual([
      ['Why [thing] failed in [year]', 'slot'],
      ['How [thing] vanished', 'bible'],
    ]);
    expect(plan.hook?.beats).toEqual([{ beat: 'Cold open', does: 'Mid-scene.' }]);
    expect(plan.chapters).toEqual([{ beat: 'Setup', does: 'Who and where.' }]);
    expect(plan.pacingRules).toEqual(['Hold a map while the scene is set.']);
    expect(plan.visualStyle).toEqual({
      slot: 'Item 4',
      summary: 'Dark ground, red accent.',
      components: ['Map pin'],
      motion: ['Line draws outward'],
    });
    expect(plan.thumbnails.layouts).toEqual([
      { name: 'Object on dark', layout: 'Left object', prompt: 'A plane on black.' },
    ]);
    expect(plan.bible).toEqual({ engine: 'claude', writtenAt: NOW.toISOString() });
  });

  test('an empty format plans nothing', () => {
    const plan = formatPlan({ ...format, slots: {} }, shelf);
    expect(plan.titleFormulas).toEqual([]);
    expect(plan.hook).toBeNull();
    expect(plan.wordsPerMinute).toBeNull();
    expect(plan.visualStyle.slot).toBeNull();
  });
});

describe('a title against a formula', () => {
  test('fits when the fixed words come in order around filled slots', () => {
    expect(titleFits('Why [thing] failed in [year]', 'Why Concorde Failed in 2003')).toBe(true);
    expect(titleFits('Why [thing] failed in [year]', 'Why the Concorde failed in 2003!')).toBe(
      true,
    );
    expect(titleFits('Why [thing] failed in [year]', 'Concorde failed in 2003')).toBe(false);
    expect(titleFits('Why [thing] failed in [year]', 'Why failed in 2003')).toBe(false);
    expect(titleFits('[N] things about [place]', '7 things about Rome')).toBe(true);
    expect(titleFits('no slots at all', 'no slots at all')).toBe(false);
  });
});

describe('your videos against the plan', () => {
  const video = (id: string, parts: Partial<OwnVideoInput>): OwnVideoInput => ({
    videoId: id,
    title: 'Something else',
    score: null,
    measured: null,
    ...parts,
  });

  test('counts, per slot, the videos that followed it and how they did', () => {
    const report = followedSlots(formatPlan(format, shelf), [
      video('v1', { title: 'Why Concorde failed in 2003', score: 3 }),
      video('v2', { title: 'Why Kodak failed in 2012', score: 5 }),
      video('v3', {
        score: 1,
        measured: { cutsPerMinute: 11, wordsPerMinute: 150, palette: ['#121212', '#F0F0F0'] },
      }),
      video('v4', {
        score: null,
        measured: { cutsPerMinute: 30, wordsPerMinute: null, palette: ['#00FF00'] },
      }),
    ]);
    expect(report.videos).toBe(4);
    const title = report.slots.find((slot) => slot.layer === 'title');
    expect(title).toEqual({
      layer: 'title',
      check: 'title fits one of its formulas',
      followed: 2,
      not: 2,
      unknown: 0,
      medianScoreFollowed: 4,
      medianScoreNot: 1,
    });
    const pacing = report.slots.find((slot) => slot.layer === 'pacing');
    expect(pacing).toMatchObject({ followed: 1, not: 1, unknown: 2, medianScoreFollowed: 1 });
    expect(pacing?.medianScoreNot).toBeNull();
    const visual = report.slots.find((slot) => slot.layer === 'visual');
    expect(visual).toMatchObject({ followed: 1, not: 1, unknown: 2 });
    expect(report.rows[0]).toEqual({
      videoId: 'v1',
      title: 'Why Concorde failed in 2003',
      score: 3,
      followed: ['title'],
      not: [],
    });
    expect(report.rows[2]).toMatchObject({ followed: ['pacing', 'visual'], not: ['title'] });
  });

  test('a plan with nothing code can check has no slot rows', () => {
    const report = followedSlots(formatPlan({ ...format, slots: {} }, shelf), [video('v1', {})]);
    expect(report.slots).toEqual([]);
    expect(report.rows).toEqual([
      { videoId: 'v1', title: 'Something else', score: null, followed: [], not: [] },
    ]);
  });
});

describe('a breakdown part’s measured layer', () => {
  const group = {
    videos: 4,
    measured: 3,
    medianCutsPerMinute: 9.5,
    medianShotSeconds: 6.3,
    medianWordsPerMinute: 158,
    medianSentenceWords: 11,
    medianHookWordsPerMinute: 171,
    medianIntegratedLufs: -14.2,
    medianLoudnessRangeLu: 6.1,
    medianTransitionsPerMinute: 1.2,
    medianAnimationsPerMinute: 3.4,
    transitions: {},
    camera: {},
  };
  const facts = {
    winners: group,
    ordinary: { ...group, medianCutsPerMinute: null },
    palette: {
      items: [{ hex: '#0A0B0E', share: 0.5 }],
      method: 'weighted k-means',
    },
    methods: {
      pace: 'ffmpeg scene',
      words: 'captions',
      loudness: 'ebur128',
      transitions: 'frames',
    },
  } as unknown as ChannelFacts;

  test('puts the winners’ medians on the layer they bear on, each with its method', () => {
    expect(measuredForLayer('pacing', facts).measured).toEqual([
      {
        label: 'Cuts a minute',
        value: 9.5,
        unit: 'a minute',
        method: 'median of 3 measured winners; ffmpeg scene',
      },
      {
        label: 'Median shot',
        value: 6.3,
        unit: 'seconds',
        method: 'median of 3 measured winners; ffmpeg scene',
      },
      {
        label: 'Words a minute',
        value: 158,
        unit: 'words a minute',
        method: 'median of 4 winners; captions',
      },
    ]);
    const visual = measuredForLayer('visual', facts);
    expect(visual.palette).toEqual([{ hex: '#0A0B0E', share: 0.5 }]);
    expect(visual.measured[0]).toEqual({
      label: '#0A0B0E',
      value: 50,
      unit: '% of runtime',
      method: 'weighted k-means',
    });
    expect(measuredForLayer('sound', facts).measured.map((one) => one.label)).toEqual([
      'Integrated loudness',
      'Loudness range',
    ]);
    expect(measuredForLayer('hook', facts).measured.map((one) => one.label)).toEqual([
      'Pace of the opening',
    ]);
    expect(measuredForLayer('motion', facts).measured.map((one) => one.label)).toEqual([
      'Transitions a minute',
      'Animations a minute',
      'Cuts a minute',
    ]);
    expect(measuredForLayer('title', facts)).toEqual({ measured: [], palette: [] });
  });

  test('a median code could not take is left out', () => {
    const none = { ...facts, winners: { ...group, medianCutsPerMinute: null, measured: 0 } };
    expect(
      measuredForLayer('pacing', none as unknown as ChannelFacts).measured.map((one) => one.label),
    ).toEqual(['Median shot', 'Words a minute']);
  });
});

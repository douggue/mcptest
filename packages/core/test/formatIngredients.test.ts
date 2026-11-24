import { describe, expect, test } from 'vitest';
import { draftProblem, isProven } from '../src/format/evidence';
import { ingredientFromBreakdownPart } from '../src/format/fromBreakdown';
import {
  ingredientFromFormula,
  ingredientFromHook,
  ingredientFromTransferFormat,
  ingredientFromTransferIdea,
  shortName,
} from '../src/format/fromLab';
import { ingredientFromClip, ingredientFromImage, ingredientFromNote } from '../src/format/fromOwn';
import { TEARDOWN_SECTIONS, ingredientFromTeardown } from '../src/format/fromTeardown';
import {
  ingredientFromNiche,
  ingredientFromUnreadLink,
  ingredientFromVideo,
  type FormatVideo,
} from '../src/format/fromVideo';
import { buildTeardownReport } from '../src/teardown/report';
import {
  CENTER,
  CHANNEL_A,
  CHANNEL_B,
  FORMAT,
  FORMULA,
  IDEA,
  NICHE,
  TEARDOWN,
  TEARDOWN_INPUT,
  hook,
} from './formatFixtures';

describe('shortName', () => {
  test('keeps a short name and cuts a long one on a word', () => {
    expect(shortName('  two   words ')).toBe('two words');
    expect(shortName('alpha beta gamma delta', 12)).toBe('alpha beta…');
    expect(shortName('abcdefghijklmnop', 8)).toBe('abcdefg…');
  });
});

describe('a title formula', () => {
  test('carries the counts the store gave it, and is proven across two channels', () => {
    const draft = ingredientFromFormula(CENTER, 90, FORMULA);
    expect(draft).toMatchObject({
      layer: 'title',
      source: 'formula',
      sourceKey: `${CENTER}:90:7`,
      channelIds: [CHANNEL_A, CHANNEL_B],
      evidence: { score: 3, scoredVideos: 2, videos: 2, channels: 2 },
    });
    expect(draft.media).toEqual([
      { kind: 'thumbnail', videoId: 'aaaaaaaaaa1' },
      { kind: 'thumbnail', videoId: 'bbbbbbbbbb1' },
    ]);
    expect(isProven(draft.evidence)).toBe(true);
    expect(draftProblem(draft)).toBeNull();
  });
});

describe('the transfer list', () => {
  test('a title format counts its videos, channels and median views', () => {
    const draft = ingredientFromTransferFormat(FORMAT);
    expect(draft.evidence).toMatchObject({ videos: 4, channels: 3, score: null });
    expect(draft.evidence.measured[0]).toMatchObject({ label: 'Median views', value: 4000 });
    expect(draft.details).toMatchObject({ subjects: ['cars'] });
  });

  test('an idea averages the scores its versions have', () => {
    const draft = ingredientFromTransferIdea(IDEA);
    expect(draft.evidence).toMatchObject({ score: 5, scoredVideos: 1, videos: 2, channels: 2 });
    expect(draft.evidence.measured).toHaveLength(1);
    expect(ingredientFromTransferIdea({ ...IDEA, best: null }).evidence.measured).toEqual([]);
  });
});

describe('a hook', () => {
  test('a named way of opening counts every library hook given the same name', () => {
    const library = [
      hook(),
      hook({ videoId: 'bbbbbbbbbb1', channelId: CHANNEL_B, score: 2, style: 'cold OPEN' }),
      hook({ videoId: 'bbbbbbbbbb2', channelId: CHANNEL_B, style: 'Question' }),
    ];
    const draft = ingredientFromHook(CENTER, hook(), library);
    expect(draft.name).toBe('Cold open');
    expect(draft.evidence).toMatchObject({ videos: 2, channels: 2, score: 4, scoredVideos: 2 });
    expect(draft.evidence.measured.map((number) => number.value)).toEqual([150, 155]);
    expect(draft.media.at(-1)).toMatchObject({ kind: 'quote', videoId: 'aaaaaaaaaa1' });
    expect(isProven(draft.evidence)).toBe(true);
  });

  test('an unnamed opening is its one video, with nothing to measure when it has no words', () => {
    const lone = hook({ style: null, text: null, words: null, lastLineAtSeconds: null });
    const draft = ingredientFromHook(CENTER, lone, [lone]);
    expect(draft.name).toBe('Opening of “Title aaaaaaaaaa1”');
    expect(draft.evidence).toMatchObject({ videos: 1, channels: 1 });
    expect(draft.evidence.measured).toEqual([]);
    expect(draft.media).toEqual([{ kind: 'thumbnail', videoId: 'aaaaaaaaaa1' }]);
    expect(isProven(draft.evidence)).toBe(false);
  });
});

describe('one video or channel', () => {
  const facts: FormatVideo = {
    videoId: 'aaaaaaaaaa1',
    title: 'A breakout',
    channelId: CHANNEL_A,
    channelTitle: 'Alpha',
    views: 5000,
    durationSeconds: 600,
    score: 12,
  };

  test('a breakout is a raw source of one video, never proven however high its score', () => {
    const draft = ingredientFromVideo(facts, 'video', CENTER);
    expect(draft).toMatchObject({
      layer: 'other',
      source: 'video',
      sourceLabel: 'Breaking out · Alpha',
    });
    expect(draft.evidence).toMatchObject({ score: 12, scoredVideos: 1, videos: 1, channels: 1 });
    expect(draft.evidence.measured.map((number) => number.label)).toEqual(['Views', 'Length']);
    expect(isProven(draft.evidence)).toBe(false);
  });

  test('a thumbnail fills the thumbnail layer; a link or an own video keeps its source', () => {
    const unscored = { ...facts, score: null, durationSeconds: null };
    expect(ingredientFromVideo(unscored, 'thumbnail', null)).toMatchObject({
      layer: 'thumbnail',
      source: 'thumbnail',
      evidence: { scoredVideos: 0, measured: [{ label: 'Views' }] },
    });
    expect(ingredientFromVideo(facts, 'own-video', CENTER).source).toBe('own-video');
    expect(ingredientFromVideo(facts, 'link', null).source).toBe('link');
  });

  test('a link to a video not stored keeps only its id', () => {
    const draft = ingredientFromUnreadLink('zzzzzzzzzzz');
    expect(draft.evidence).toMatchObject({ videos: null, channels: null, measured: [] });
    expect(draftProblem(draft)).toBeNull();
  });

  test('a niche channel counts its strong outliers', () => {
    const draft = ingredientFromNiche(NICHE);
    expect(draft.evidence).toMatchObject({ videos: 3, channels: 1 });
    expect(draft.evidence.measured[1]).toMatchObject({ value: 3, unit: 'of 8' });
    expect(draft.sourceLabel).toBe('New niche · Science');
  });
});

describe('a breakdown part', () => {
  const source = {
    channelId: CHANNEL_A,
    channelTitle: 'Alpha',
    part: 'picture' as const,
    engine: 'claude',
    text: 'x'.repeat(5000),
    measured: [],
  };

  test('is an engine’s reading of one channel, kept cut short and never proven', () => {
    const draft = ingredientFromBreakdownPart(source);
    expect(draft).toMatchObject({ layer: 'visual', name: 'Picture and sound of Alpha' });
    expect(draft.details).toMatchObject({ engine: 'claude', cut: true });
    expect(String(draft.details['reading'])).toHaveLength(4000);
    expect(isProven(draft.evidence)).toBe(false);
  });

  test('the owner may put it on another layer', () => {
    expect(ingredientFromBreakdownPart(source, 'motion').layer).toBe('motion');
  });
});

describe('a teardown section', () => {
  test('every section makes an ingredient from the fixture', () => {
    for (const section of TEARDOWN_SECTIONS) {
      const draft = ingredientFromTeardown(TEARDOWN, section);
      expect(draft, section).not.toBeNull();
      expect(draftProblem(draft!), section).toBeNull();
      expect(isProven(draft!.evidence)).toBe(false);
    }
  });

  test('pacing and palette carry the measured numbers with their methods', () => {
    const pacing = ingredientFromTeardown(TEARDOWN, 'metrics')!;
    expect(pacing.layer).toBe('pacing');
    expect(pacing.evidence.measured.map((number) => [number.label, number.value])).toEqual([
      ['Cuts a minute', 2.5],
      ['Median shot', 15],
      ['Average shot', 20],
      ['Words a minute', expect.any(Number)],
    ]);
    const palette = ingredientFromTeardown(TEARDOWN, 'palette')!;
    expect(palette.details['palette']).toEqual([
      { hex: '#0A0B0E', share: 0.7 },
      { hex: '#E63946', share: 0.2 },
    ]);
    expect(palette.evidence.measured[0]).toMatchObject({ value: 70, method: 'k-means' });
  });

  test('a component and a motion item show their picture and are keyed by number', () => {
    const component = ingredientFromTeardown(TEARDOWN, 'component', 0)!;
    expect(component.name).toBe('Timeline grid · A test video');
    expect(component.sourceKey).toBe('abcdefghijk:component:0');
    expect(component.media).toEqual([
      { kind: 'keyframe', videoId: 'abcdefghijk', file: 'k-001.jpg' },
    ]);
    const motion = ingredientFromTeardown(TEARDOWN, 'motion', 0)!;
    expect(motion.media).toEqual([{ kind: 'strip', videoId: 'abcdefghijk', file: 's-001.jpg' }]);
    expect(ingredientFromTeardown(TEARDOWN, 'motion', 4)).toBeNull();
    expect(ingredientFromTeardown(TEARDOWN, 'component', 4)).toBeNull();
  });

  test('sound keeps loudness from code; transitions count the kinds seen', () => {
    const sound = ingredientFromTeardown(TEARDOWN, 'sound')!;
    expect(sound.evidence.measured.map((number) => number.unit)).toEqual(['LUFS', 'LU', 'dBFS']);
    const transitions = ingredientFromTeardown(TEARDOWN, 'transitions')!;
    expect(transitions.evidence.measured.map((number) => number.label)).toEqual([
      'Transitions: cut',
      'Transitions: dissolve',
      'Cuts a minute of its video',
    ]);
  });

  test('nothing without measurements, a missing design stage or missing parts', () => {
    const bare = buildTeardownReport({
      ...TEARDOWN_INPUT,
      about: null,
      transcript: null,
      stages: {},
      measured: {
        ...TEARDOWN_INPUT.measured!,
        loudness: null,
        motion: null,
        hookSheet: null,
      },
    });
    expect(ingredientFromTeardown(bare, 'typography')).toBeNull();
    expect(ingredientFromTeardown(bare, 'sound')!.evidence.measured).toEqual([]);
    expect(
      ingredientFromTeardown(bare, 'transitions')!.evidence.measured.map((n) => n.label),
    ).toEqual(['Cuts a minute of its video']);
    expect(ingredientFromTeardown(bare, 'metrics')!.evidence.measured[0]?.label).toBe(
      'Cuts a minute',
    );
    expect(ingredientFromTeardown(bare, 'hook')!.media).toEqual([]);
    const metrics = ingredientFromTeardown(bare, 'metrics')!;
    expect(metrics.evidence.measured).toHaveLength(3);
    expect(metrics.channelIds).toEqual([]);
    expect(metrics.name).toBe('Pacing · Video abcdefghijk');
    expect(ingredientFromTeardown({ ...bare, measured: null }, 'metrics')).toBeNull();
  });
});

describe('the owner’s own', () => {
  test('a note keeps its text and counts nothing', () => {
    const draft = ingredientFromNote({ layer: 'pacing', name: 'Slow', text: '  breathe  ' }, 'n1');
    expect(draft).toMatchObject({ source: 'note', details: { text: 'breathe' }, channelIds: [] });
    expect(draft.evidence.videos).toBeNull();
  });

  test('a picture or a clip must be a file Jgtube saved', () => {
    const image = ingredientFromImage({ layer: 'visual', name: 'Mood', file: 'abcdefghijk.png' });
    expect(image.media).toEqual([{ kind: 'image', file: 'abcdefghijk.png' }]);
    expect(() => ingredientFromImage({ layer: 'visual', name: 'x', file: '../a.png' })).toThrow();
    expect(ingredientFromClip({ layer: 'motion', name: 'Clip', file: 'abcdefghijk' }).source).toBe(
      'clip',
    );
    expect(() => ingredientFromClip({ layer: 'motion', name: 'x', file: 'a/b' })).toThrow();
  });
});

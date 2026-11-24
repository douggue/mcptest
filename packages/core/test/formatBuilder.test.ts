import { describe, expect, test } from 'vitest';
import {
  CUTS_LABEL,
  filledSlots,
  formatChecks,
  hookLimit,
  hookSeconds,
  videosOf,
} from '../src/format/checks';
import {
  applySuggestion,
  changeProblem,
  clearSlot,
  fillSlot,
  liveSlots,
  noteSlot,
  type FormatSlots,
  type MixSuggestion,
} from '../src/format/formats';
import { checkMix } from '../src/format/mix';
import type { Ingredient, IngredientEvidence, MeasuredNumber } from '../src/format/types';

const A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const B = 'UCbbbbbbbbbbbbbbbbbbbbbb';
const NOW = new Date('2026-11-24T10:00:00Z');

const number = (label: string, value: number): MeasuredNumber => ({
  label,
  value,
  unit: '',
  method: 'm',
});

const item = (id: number, parts: Partial<Ingredient> = {}): Ingredient => ({
  id,
  layer: 'title',
  name: `Item ${id}`,
  source: 'formula',
  sourceKey: String(id),
  sourceLabel: 'x',
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
const evidence = (measured: MeasuredNumber[]): IngredientEvidence => ({
  score: null,
  scoredVideos: 0,
  videos: 1,
  channels: 1,
  measured,
});

describe('slots', () => {
  test('fill, note, clear and drop slots without changing the ones given', () => {
    const empty: FormatSlots = {};
    const one = fillSlot(empty, 'hook', 3);
    expect(empty).toEqual({});
    const noted = noteSlot(one, 'hook', 'shorter');
    expect(fillSlot(noted, 'hook', 4)).toEqual({ hook: { ingredientId: 4, note: 'shorter' } });
    expect(noteSlot(one, 'title', 'x')).toBe(one);
    expect(clearSlot(noted, 'hook')).toEqual({});
    expect(liveSlots({ ...noted, title: { ingredientId: 9, note: '' } }, new Set([3]))).toEqual(
      noted,
    );
  });

  test('a suggestion fills its slots and keeps the owner’s notes', () => {
    const suggestion: MixSuggestion = {
      slots: [{ layer: 'hook', ingredientId: 5, reason: 'r' }],
      summary: '',
      dropped: [],
      engine: 'claude',
      writtenAt: NOW.toISOString(),
    };
    const slots = noteSlot(fillSlot({}, 'hook', 3), 'hook', 'mine');
    expect(applySuggestion(slots, suggestion)).toEqual({ hook: { ingredientId: 5, note: 'mine' } });
  });

  test('a change must have a name, a length in range and notes that fit', () => {
    expect(changeProblem({ name: 'Long-form', targetSeconds: 600 })).toBeNull();
    expect(changeProblem({ targetSeconds: null })).toBeNull();
    expect(changeProblem({ name: ' ' })).toMatch(/name/);
    expect(changeProblem({ targetSeconds: 5 })).toMatch(/length/);
    expect(changeProblem({ targetSeconds: 60.5 })).toMatch(/length/);
    expect(changeProblem({ notes: 'x'.repeat(5000) })).toMatch(/notes/);
  });
});

describe('hookSeconds and hookLimit', () => {
  test('from words and pace, else from the beats’ times, else unknown', () => {
    const counted = item(1, {
      evidence: evidence([
        number('Words in the first minute', 150),
        number('Pace of the opening', 150),
      ]),
    });
    expect(hookSeconds(counted)).toBe(60);
    const beats = item(2, { details: { rows: [{ end: 9 }, { end: 21.4 }, { end: 'x' }, null] } });
    expect(hookSeconds(beats)).toBe(21);
    expect(hookSeconds(item(3, { details: { rows: [] } }))).toBeNull();
    expect(hookSeconds(item(4))).toBeNull();
  });

  test('a Short’s hook is ten seconds; a long video’s a minute or a tenth', () => {
    expect(hookLimit(50)).toBe(10);
    expect(hookLimit(480)).toBe(60);
    expect(hookLimit(1800)).toBe(180);
  });
});

describe('formatChecks', () => {
  const hook = item(1, {
    layer: 'hook',
    channelIds: [A],
    media: [{ kind: 'thumbnail', videoId: 'hookvideo01' }],
    evidence: evidence([
      number('Words in the first minute', 150),
      number('Pace of the opening', 150),
    ]),
  });
  const pacing = item(2, {
    layer: 'pacing',
    channelIds: [A],
    evidence: evidence([number(CUTS_LABEL, 3)]),
  });
  const motion = item(3, {
    layer: 'motion',
    channelIds: [A],
    evidence: evidence([number(`${CUTS_LABEL} of its video`, 14)]),
  });
  const thumbnail = item(4, {
    layer: 'thumbnail',
    channelIds: [B],
    proven: true,
    details: { videoId: 'thumbvideo1' },
  });
  const shelf = [hook, pacing, motion, thumbnail];
  const slots: FormatSlots = {
    hook: { ingredientId: 1, note: '' },
    pacing: { ingredientId: 2, note: '' },
    motion: { ingredientId: 3, note: '' },
    thumbnail: { ingredientId: 4, note: '' },
  };

  test('flags a long hook, clashing paces and a thumbnail from another video', () => {
    const checks = formatChecks({ slots, targetSeconds: 50 }, shelf);
    expect(checks.clashes.map((clash) => clash.kind)).toEqual([
      'hook-length',
      'pace-motion',
      'thumbnail-hook',
    ]);
    expect(checks.clashes[0]?.says).toBe(
      'The hook runs about 60 s, longer than the 10 s that fits a 50 s video.',
    );
    expect(checks.clashes[1]?.says).toMatch(/3 cuts a minute, the motion from one with 14/);
    expect(checks.unproven).toEqual(['hook', 'pacing', 'motion']);
  });

  test('says when one channel fills more than three in five slots', () => {
    const { originality } = formatChecks({ slots, targetSeconds: null }, shelf);
    expect(originality).toEqual({
      filled: 4,
      channelId: A,
      fromChannel: 3,
      share: 0.75,
      layers: ['hook', 'pacing', 'motion'],
      copiesOneChannel: true,
    });
  });

  test('stays quiet when things fit, and with too few slots to judge', () => {
    const fitting = { ...slots, motion: undefined, thumbnail: undefined };
    const sameVideo = item(5, {
      layer: 'thumbnail',
      channelIds: [B],
      media: [{ kind: 'thumbnail', videoId: 'hookvideo01' }],
    });
    const checks = formatChecks(
      { slots: { ...fitting, thumbnail: { ingredientId: 5, note: '' } }, targetSeconds: 900 },
      [...shelf, sameVideo],
    );
    expect(checks.clashes).toEqual([]);
    const lone = formatChecks({ slots: { hook: slots.hook! }, targetSeconds: null }, shelf);
    expect(lone.originality).toMatchObject({ filled: 1, channelId: null, copiesOneChannel: false });
    const mine = item(6, { layer: 'sound', channelIds: [] });
    const own = formatChecks(
      {
        slots: { sound: { ingredientId: 6, note: '' }, title: { ingredientId: 7, note: '' } },
        targetSeconds: null,
      },
      [mine, item(7, { channelIds: [] })],
    );
    expect(own.originality.channelId).toBeNull();
  });

  test('compares pace with the visual style when there is no motion, and skips unknown paces', () => {
    const visual = item(8, { layer: 'visual', evidence: evidence([number(CUTS_LABEL, 12)]) });
    const checks = formatChecks(
      {
        slots: { pacing: slots.pacing!, visual: { ingredientId: 8, note: '' } },
        targetSeconds: null,
      },
      [pacing, visual],
    );
    expect(checks.clashes[0]).toMatchObject({ kind: 'pace-motion', layers: ['pacing', 'visual'] });
    const unknown = formatChecks(
      {
        slots: { pacing: slots.pacing!, motion: { ingredientId: 9, note: '' } },
        targetSeconds: null,
      },
      [pacing, item(9, { layer: 'motion' })],
    );
    expect(unknown.clashes).toEqual([]);
    const unmeasuredHook = formatChecks(
      {
        slots: { hook: { ingredientId: 10, note: '' }, thumbnail: { ingredientId: 11, note: '' } },
        targetSeconds: 50,
      },
      [item(10, { layer: 'hook' }), item(11, { layer: 'thumbnail' })],
    );
    expect(unmeasuredHook.clashes).toEqual([]);
  });

  test('a slot naming an ingredient no longer on the shelf counts as empty', () => {
    expect(filledSlots({ hook: { ingredientId: 99, note: '' } }, shelf)).toEqual({});
    expect([...videosOf(thumbnail)]).toEqual(['thumbvideo1']);
  });
});

describe('checkMix', () => {
  const shelf = [item(1, { layer: 'hook' }), item(2, { layer: 'title' })];
  const answer = (value: unknown) => `Here it is:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

  test('keeps slots naming ingredients on the shelf and on their layer, one per layer', () => {
    const checked = checkMix(
      answer({
        summary: 'A calm explainer.',
        slots: [
          { layer: 'hook', ingredient: 1, reason: 'Cold open: 3 videos, 2 channels.' },
          { layer: 'hook', ingredient: 1, reason: 'again' },
          { layer: 'title', ingredient: 1, reason: 'wrong layer' },
          { layer: 'title', ingredient: 7, reason: 'not there' },
          { layer: 'colour', ingredient: 2, reason: 'no such layer' },
          { layer: 'title', ingredient: 2, reason: 'x'.repeat(400) },
        ],
      }),
      shelf,
      'claude',
      NOW,
    );
    if (!checked.ok) throw new Error(checked.reason);
    expect(checked.suggestion.slots.map((slot) => [slot.layer, slot.ingredientId])).toEqual([
      ['hook', 1],
      ['title', 2],
    ]);
    expect(checked.suggestion.slots[1]?.reason).toHaveLength(300);
    expect(checked.suggestion.dropped).toHaveLength(4);
    expect(checked.suggestion).toMatchObject({ summary: 'A calm explainer.', engine: 'claude' });
  });

  test('refuses an answer with no mix, or none on the shelf', () => {
    expect(checkMix('no json', shelf, 'claude', NOW)).toEqual({
      ok: false,
      reason: 'the answer held no mix in the form asked for',
    });
    expect(
      checkMix(answer({ slots: [{ layer: 'hook', ingredient: 9 }] }), shelf, 'c', NOW),
    ).toEqual({
      ok: false,
      reason: 'no slot named an ingredient on the shelf',
    });
  });
});

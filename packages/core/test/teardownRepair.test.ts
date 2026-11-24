import { describe, expect, test } from 'vitest';
import { checkStage, type TeardownStage } from '../src/teardown/stages';

const long = (chars: number): string =>
  `${'Something is shown here. '.repeat(Math.ceil(chars / 25))}`.slice(0, chars);
const ask = <S extends TeardownStage>(stage: S, value: unknown) =>
  checkStage(stage, JSON.stringify(value));

describe('a teardown stage with one thing wrong is kept, not refused', () => {
  test('a text too long for its field is shortened at the end of a sentence, and the stage says so', () => {
    const checked = ask('techniques', {
      items: [{ name: 'Open loop', description: long(900), quotes: [{ text: 'A line.', at: 3 }] }],
    });

    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const [item] = checked.data.items;
    expect(item?.description.length).toBeLessThanOrEqual(600);
    expect(item?.description.endsWith('.')).toBe(true);
    expect(checked.repaired).toEqual(['items 1, description: shortened to fit.']);
  });

  test('a keyframe that is not a keyframe name becomes none, and the item stays', () => {
    const checked = ask('archetypes', {
      items: [
        { name: 'Map', description: 'A map.', keyframe: 'frame 12', at: [4], buildWith: 'code' },
        { name: 'Card', description: 'A card.', keyframe: 'k-003', at: [9], buildWith: 'code' },
      ],
    });

    expect(checked.ok && checked.data.items.map((item) => item.keyframe)).toEqual([null, 'k-003']);
    expect(checked.ok && checked.repaired).toEqual([
      'items 1, keyframe: not a keyframe name, so left empty.',
    ]);
  });

  test('a hex, a strip or a time that is not one is dropped from its list, and the rest stays', () => {
    const design = ask('design', {
      colourModes: [{ name: 'Night', hexes: ['#0A0B0E', 'navy', '#FFFFFF'], use: 'The ground.' }],
      typography: [],
      motion: [{ name: 'Slide', description: 'It slides.', at: [3, 'soon', 12] }],
    });
    const motion = ask('motion', {
      items: [
        {
          name: 'Wipe',
          kind: 'transition',
          strips: ['s-001', 'strip two'],
          at: [5],
          rebuild: { method: 'editor', recipe: 'A wipe.' },
        },
      ],
    });

    expect(design.ok && design.data.colourModes[0]?.hexes).toEqual(['#0A0B0E', '#FFFFFF']);
    expect(design.ok && design.data.motion[0]?.at).toEqual([3, 12]);
    expect(design.ok && design.repaired).toHaveLength(2);
    expect(motion.ok && motion.data.items[0]?.strips).toEqual(['s-001']);
  });

  test('a list longer than is kept loses its tail, and says how many', () => {
    const quotes = Array.from({ length: 9 }, (_, at) => ({ text: `Line ${at}.`, at }));

    const checked = ask('techniques', { items: [{ name: 'N', description: 'D.', quotes }] });

    expect(checked.ok && checked.data.items[0]?.quotes).toHaveLength(6);
    expect(checked.ok && checked.repaired).toEqual(['items 1, quotes: only the first 6 are kept.']);
  });

  test('a row whose time cannot be read is left out, and the other rows stay', () => {
    const checked = ask('hook', {
      summary: 's',
      rows: [
        { start: 'later', end: 2, visual: 'v' },
        { start: 2, end: 4, visual: 'w' },
      ],
    });

    expect(checked.ok && checked.data.rows.map((row) => row.visual)).toEqual(['w']);
    expect(checked.ok && checked.repaired).toEqual([
      'rows 1: its time could not be read, so it was left out.',
    ]);
  });

  test('a way to rebuild that is not one of the four words leaves that item out', () => {
    const item = (method: string) => ({
      name: 'Move',
      kind: 'text',
      strips: [],
      at: [],
      rebuild: { method, recipe: 'A recipe.' },
    });

    const checked = ask('motion', { items: [item('after effects'), item('code')] });

    expect(checked.ok && checked.data.items).toHaveLength(1);
    expect(checked.ok && checked.repaired).toEqual([
      'items 1: its way to rebuild was none of code, ai-video, editor or stock, so it was left out.',
    ]);
  });

  test('a kind of motion that is not one of the kinds becomes other', () => {
    const checked = ask('motion', {
      items: [
        { name: 'M', kind: 'reveal', strips: [], at: [], rebuild: { method: 'code', recipe: 'r' } },
      ],
    });

    expect(checked.ok && checked.data.items[0]?.kind).toBe('other');
  });

  test('a null where a text may be left out is a text left out, and nothing is said of it', () => {
    const hook = ask('hook', {
      summary: 's',
      rows: [{ start: 0, end: 5, visual: 'x', camera: null, onScreenText: null }],
    });
    const motion = ask('motion', {
      items: [
        {
          name: 'M',
          kind: 'text',
          strips: null,
          at: [1],
          easing: null,
          rebuild: { method: 'code', recipe: 'r' },
        },
      ],
    });

    expect(hook).toMatchObject({ ok: true, repaired: [] });
    expect(hook.ok && hook.data.rows[0]).toMatchObject({ camera: '', onScreenText: '' });
    expect(motion).toMatchObject({ ok: true, repaired: [] });
    expect(motion.ok && motion.data.items[0]).toMatchObject({ easing: '', strips: [] });
  });

  test('a required text left empty reads “not stated”, and the stage says so', () => {
    const hook = ask('hook', { summary: 's', rows: [{ start: 0, end: 5, visual: '  ' }] });
    const sound = ask('sound', { voice: 'v', music: '', sfx: [], mix: 'm' });

    expect(hook.ok && hook.data.rows[0]?.visual).toBe('not stated');
    expect(hook.ok && hook.repaired).toEqual([
      'rows 1, visual: left empty, so it reads “not stated”.',
    ]);
    expect(sound.ok && sound.data.music).toBe('not stated');
  });

  test('a name, a ready prompt or a quoted line left empty is never filled in: the stage is refused, naming it', () => {
    const noName = ask('archetypes', {
      items: [{ name: '', description: 'd', keyframe: 'k-001', at: [], buildWith: 'b' }],
    });
    const noPrompt = ask('plan', {
      layers: [{ layer: 'l', toolType: 't', produces: 'p' }],
      components: [],
      workflow: ['w'],
      prompts: { script: '', visuals: [], thumbnail: 't' },
      avoid: ['a'],
    });
    const nullSummary = ask('hook', { summary: null, rows: [{ start: 0, end: 5, visual: 'x' }] });

    expect(noName).toEqual({ ok: false, reason: expect.stringMatching(/items\.0\.name/) });
    expect(noPrompt).toEqual({ ok: false, reason: expect.stringMatching(/prompts\.script/) });
    expect(nullSummary).toEqual({ ok: false, reason: expect.stringMatching(/summary/) });
  });

  test('an empty entry of a list of texts is left out', () => {
    const plan = ask('plan', {
      layers: [{ layer: 'l', toolType: 't', produces: 'p' }],
      components: [],
      workflow: ['first', '', 'third'],
      prompts: { script: 's', visuals: [], thumbnail: 't' },
      avoid: ['a'],
    });

    expect(plan.ok && plan.data.workflow).toEqual(['first', 'third']);
  });

  test('a stage that fits has nothing repaired', () => {
    const fine = ask('sound', { voice: 'v', music: 'm', sfx: [], mix: 'x' });

    expect(fine).toMatchObject({ ok: true, repaired: [] });
  });

  test('what cannot be repaired is still refused: nothing is made up to fill a required part', () => {
    expect(ask('sound', { voice: 'v', music: 'm', sfx: [] }).ok).toBe(false);
    expect(ask('hook', { summary: 's', rows: [{ start: 'later', end: 2, visual: 'v' }] })).toEqual({
      ok: false,
      reason: expect.stringMatching(/rows/),
    });
    expect(ask('structure', { format: 'f', summary: 's', chapters: 'none' }).ok).toBe(false);
  });
});

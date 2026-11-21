import { describe, expect, test } from 'vitest';
import {
  CONCEPTS_PER_BATCH,
  MAX_TITLE_CHARS,
  batchNote,
  namedVideoIds,
  needsSomething,
  parseConcepts,
} from '../src/concepts/parse';

const VIDEO_A = 'aaaaaaaaaa1';
const VIDEO_B = 'bbbbbbbbbb1';

const block = (number: number, overrides: Record<string, string | null> = {}): string => {
  const lines: Record<string, string | null> = {
    TITLE: `The Machine Nobody Switched Off ${number}`,
    ALT1: `ALT: Why This Machine Still Runs ${number}`,
    ALT2: `ALT: The Factory That Forgot Its Own Machine ${number}`,
    THUMBNAIL: 'A rusted press in an empty hall, one lamp still on above it.',
    OVERLAY: 'STILL RUNNING',
    HOOK: 'Nobody switched it off, and nobody alive knows why it still works.',
    'RESTS ON': `${VIDEO_A}: the cold open on a single object.`,
    NEEDS: 'nothing',
    ...overrides,
  };
  const body = Object.entries(lines).flatMap(([label, value]) => {
    if (value === null) return [];
    return [label.startsWith('ALT') ? value : `${label}: ${value}`];
  });
  return [`CONCEPT ${number}`, ...body].join('\n');
};

const answer = (count: number): string =>
  Array.from({ length: count }, (_, index) => block(index + 1)).join('\n\n');

describe('reading a batch of concepts', () => {
  test('asks for ten', () => {
    expect(CONCEPTS_PER_BATCH).toBe(10);
  });

  test('reads every labelled part of every concept, in order', () => {
    const { concepts, unread } = parseConcepts(answer(10), 10);

    expect(unread).toBe(0);
    expect(concepts).toHaveLength(10);
    expect(concepts[2]).toEqual({
      title: 'The Machine Nobody Switched Off 3',
      altTitles: ['Why This Machine Still Runs 3', 'The Factory That Forgot Its Own Machine 3'],
      thumbnail: 'A rusted press in an empty hall, one lamp still on above it.',
      overlay: 'STILL RUNNING',
      hook: 'Nobody switched it off, and nobody alive knows why it still works.',
      hookStyle: null,
      restsOn: `${VIDEO_A}: the cold open on a single object.`,
      needs: 'nothing',
    });
  });

  test('reads which library hook an opening follows the way of, when the concept says', () => {
    const text = [
      block(1, { 'HOOK STYLE': `${VIDEO_B}: cold open on one object` }),
      block(2, { 'HOOK STYLE': 'none' }),
    ].join('\n\n');

    const { concepts, unread } = parseConcepts(text, 10);

    expect(unread).toBe(0);
    expect(concepts.map((concept) => concept.hookStyle)).toEqual([
      `${VIDEO_B}: cold open on one object`,
      null,
    ]);
  });

  test('reads through the marks an engine adds although asked not to', () => {
    const marked = [
      'Here are your concepts.',
      '',
      '## 1. CONCEPT',
      '- **TITLE:** The Machine Nobody Switched Off',
      '- **ALT:** Why This Machine Still Runs',
      '- **ALT:** The Factory That Forgot Its Machine',
      '- **THUMBNAIL:** A rusted press in an empty hall,',
      '  one lamp still on above it.',
      '- **OVERLAY:** `STILL RUNNING`',
      '- **HOOK:** Nobody switched it off.',
      `- **RESTS ON:** ${VIDEO_A}: the cold open.`,
      '- **NEEDS:** nothing',
      '',
      'Let me know if you want more.',
    ].join('\n');

    const { concepts, unread } = parseConcepts(marked, 10);

    expect(unread).toBe(0);
    expect(concepts).toHaveLength(1);
    expect(concepts[0]).toMatchObject({
      title: 'The Machine Nobody Switched Off',
      thumbnail: 'A rusted press in an empty hall, one lamp still on above it.',
      overlay: 'STILL RUNNING',
      needs: 'nothing',
    });
  });

  test.each([
    ['no title', { TITLE: null }],
    ['an empty title', { TITLE: ' ' }],
    ['one alternate title only', { ALT2: null }],
    ['no thumbnail brief', { THUMBNAIL: null }],
    ['no overlay text', { OVERLAY: null }],
    ['no hook', { HOOK: null }],
    ['no rests-on line', { 'RESTS ON': null }],
    ['no needs line', { NEEDS: null }],
    ['a title longer than YouTube takes', { TITLE: 'x'.repeat(MAX_TITLE_CHARS + 1) }],
    ['a hook that runs on for pages', { HOOK: 'word '.repeat(200) }],
  ])('counts a concept with %s as unread and never fills the gap', (_name, overrides) => {
    const text = [block(1), block(2, overrides), block(3)].join('\n\n');

    const { concepts, unread } = parseConcepts(text, 10);

    expect(unread).toBe(1);
    expect(concepts.map((concept) => concept.title)).toEqual([
      'The Machine Nobody Switched Off 1',
      'The Machine Nobody Switched Off 3',
    ]);
  });

  test('counts a concept that gives a part twice as unread: it cannot tell which was meant', () => {
    const twice = `${block(1)}\nTITLE: Another Title Altogether`;

    expect(parseConcepts(twice, 10)).toEqual({ concepts: [], unread: 1 });
  });

  test('does not take a label inside a sentence for a new part', () => {
    const text = block(1, { NEEDS: 'Look up the plant. NEEDS: is a label, HOOK: is too.' });

    const { concepts } = parseConcepts(text, 10);

    expect(concepts[0]?.needs).toBe('Look up the plant. NEEDS: is a label, HOOK: is too.');
    expect(concepts[0]?.hook).toBe(
      'Nobody switched it off, and nobody alive knows why it still works.',
    );
  });

  test('takes no more concepts than were asked for', () => {
    expect(parseConcepts(answer(12), 10).concepts).toHaveLength(10);
    expect(parseConcepts(answer(5), 3).concepts).toHaveLength(3);
  });

  test('finds nothing in an answer with no concept in it', () => {
    expect(parseConcepts('I could not reach the tools.', 10)).toEqual({ concepts: [], unread: 0 });
    expect(parseConcepts('', 10)).toEqual({ concepts: [], unread: 0 });
  });
});

describe('the note under a short batch', () => {
  test('says nothing when every concept asked for was read', () => {
    expect(batchNote(10, 10, 0)).toBeNull();
  });

  test('says plainly how many came back and how many could not be read', () => {
    expect(batchNote(10, 7, 0)).toBe('The AI returned 7 concepts, not the 10 asked for.');
    expect(batchNote(10, 8, 2)).toBe(
      'The AI returned 8 concepts that could be read, not the 10 asked for. 2 more were left out because a part was missing or too long.',
    );
    expect(batchNote(3, 1, 1)).toBe(
      'The AI returned 1 concept that could be read, not the 3 asked for. 1 more was left out because a part was missing or too long.',
    );
  });
});

describe('what a concept rests on', () => {
  test('names only the picked videos it mentions, each once, in the order picked', () => {
    const restsOn = `${VIDEO_B}: the map opening. ${VIDEO_A}: the question in the title. ${VIDEO_B} again, and zzzzzzzzzz9 which was never picked.`;

    expect(namedVideoIds(restsOn, [VIDEO_A, VIDEO_B])).toEqual([VIDEO_A, VIDEO_B]);
    expect(namedVideoIds('nothing in particular', [VIDEO_A])).toEqual([]);
  });

  test('does not find an id inside a longer run of letters', () => {
    expect(namedVideoIds(`x${VIDEO_A}y`, [VIDEO_A])).toEqual([]);
  });
});

describe('the needs line', () => {
  test.each(['nothing', 'Nothing.', ' NOTHING ', 'none', 'None.'])(
    'reads "%s" as nothing to look up',
    (needs) => {
      expect(needsSomething(needs)).toBe(false);
    },
  );

  test('reads anything else as something to look up first', () => {
    expect(needsSomething('The year the plant closed.')).toBe(true);
    expect(needsSomething('Nothing certain: check the name of the plant.')).toBe(true);
  });
});

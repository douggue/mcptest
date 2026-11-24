import { describe, expect, test } from 'vitest';
import {
  checkDraft,
  replaceSections,
  sameSection,
  sectionWords,
  shortSections,
  wordBudget,
} from '../src/script/budget';

const total = (budget: readonly { readonly words: number }[] | null): number =>
  (budget ?? []).reduce((sum, section) => sum + section.words, 0);

describe('the words each section of a script is written to', () => {
  test('gives the hook its words and shares the rest among the beats by how long each runs', () => {
    // Arrange: a ten-minute script at 150 words a minute, one minute of hook.
    const beats = [
      '1:00 | The bill | Who pays',
      '4:00 | The turn | What changed',
      '7:00 | The end',
    ];

    // Act
    const budget = wordBudget({
      beats: beats.join('\n'),
      targetSeconds: 600,
      targetWords: 1500,
      hookWords: 150,
    });

    // Assert
    expect(budget).toEqual([
      { section: 'HOOK', words: 150 },
      { section: 'The bill', words: 450 },
      { section: 'The turn', words: 450 },
      { section: 'The end', words: 450 },
    ]);
  });

  test('always adds up to the whole length, whatever the rounding', () => {
    const budget = wordBudget({
      beats: '0:10 | One\n0:17 | Two\n0:31 | Three\n0:44 | Four',
      targetSeconds: 50,
      targetWords: 137,
      hookWords: 27,
    });

    expect(total(budget)).toBe(137);
    expect(budget?.every((section) => section.words > 0)).toBe(true);
  });

  test('shares the rest evenly when a beat has no time or the times do not climb', () => {
    const untimed = wordBudget({
      beats: 'The bill | Who pays\n4:00 | The turn',
      targetSeconds: 600,
      targetWords: 1000,
      hookWords: 100,
    });
    const backwards = wordBudget({
      beats: '5:00 | Late\n2:00 | Early',
      targetSeconds: 600,
      targetWords: 1000,
      hookWords: 100,
    });

    expect(untimed?.map((section) => section.words)).toEqual([100, 450, 450]);
    expect(backwards?.map((section) => section.words)).toEqual([100, 450, 450]);
  });

  test('reads a time written with hours', () => {
    const budget = wordBudget({
      beats: '0:01:00 | First\n1:00:00 | Second',
      targetSeconds: 7200,
      targetWords: 12_000,
      hookWords: 100,
    });

    expect(total(budget)).toBe(12_000);
    expect(budget?.[1]?.words).toBeLessThan(budget?.[2]?.words ?? 0);
  });

  test('is not worked out without a length, a hook length or a beat', () => {
    const beats = '1:00 | The bill';
    const whole = { beats, targetSeconds: 600, targetWords: 1500, hookWords: 150 };

    expect(wordBudget({ ...whole, targetWords: null })).toBeNull();
    expect(wordBudget({ ...whole, hookWords: null })).toBeNull();
    expect(wordBudget({ ...whole, beats: null })).toBeNull();
    expect(wordBudget({ ...whole, beats: ' \n ' })).toBeNull();
    expect(wordBudget({ ...whole, hookWords: 1500 })).toBeNull();
  });

  test('names a beat without a name by its place', () => {
    const budget = wordBudget({
      beats: '1:00 | | Something happens',
      targetSeconds: 600,
      targetWords: 1500,
      hookWords: 150,
    });

    expect(budget?.[1]).toEqual({ section: 'Beat 1', words: 1350 });
  });
});

describe('a draft checked against its budget', () => {
  const words = (count: number): string => Array.from({ length: count }, () => 'word').join(' ');
  const draft = [
    '## HOOK',
    '[B-ROLL: a wide shot | a wide shot | nothing]',
    `${words(100)} [CHECK: a fact].`,
    '## The bill',
    words(300),
    '[B-ROLL: a bill | a bill | paper]',
    words(100),
    '## The turn',
    words(200),
  ].join('\n');
  const budget = [
    { section: 'HOOK', words: 100 },
    { section: 'The bill', words: 450 },
    { section: 'The turn', words: 450 },
  ];

  test('counts the spoken words under each heading, without cues or markers', () => {
    expect(sectionWords(draft)).toEqual([
      { section: 'HOOK', words: 100 },
      { section: 'The bill', words: 400 },
      { section: 'The turn', words: 200 },
    ]);
  });

  test('lists the sections under 85% of their number, and never the hook', () => {
    // The bill has 400 of 450 (89%): close enough. The turn has 200 of 450.
    expect(shortSections(draft, budget)).toEqual([
      { section: 'The turn', words: 200, budget: 450 },
    ]);
    expect(shortSections(draft.replace(words(100), words(40)), budget)).toEqual([
      { section: 'The turn', words: 200, budget: 450 },
    ]);
  });

  test('matches a section to its number by name, whatever its case, and skips one it cannot match', () => {
    const renamed = draft.replace('## The turn', '## THE TURN').replace('## The bill', '## Mine');

    expect(shortSections(renamed, budget)).toEqual([
      { section: 'THE TURN', words: 200, budget: 450 },
    ]);
    expect(shortSections('', budget)).toEqual([]);
    expect(shortSections(draft, null)).toEqual([]);
  });

  test('puts rewritten sections in the place of the old ones and leaves the rest as it was', () => {
    const rewritten = [
      'Here they are.',
      '## the turn',
      words(430),
      '## Not in the draft',
      'x',
    ].join('\n');

    const result = replaceSections(draft, rewritten, ['The turn']);

    expect(result.replaced).toEqual(['The turn']);
    expect(sectionWords(result.script)).toEqual([
      { section: 'HOOK', words: 100 },
      { section: 'The bill', words: 400 },
      { section: 'The turn', words: 430 },
    ]);
    expect(result.script.startsWith('## HOOK\n[B-ROLL: a wide shot')).toBe(true);
  });

  test('replaces only the sections that were asked for, and nothing when none came back', () => {
    const rewritten = ['## HOOK', 'Another hook.', '## The bill', 'Short.'].join('\n');

    expect(replaceSections(draft, rewritten, ['The turn'])).toEqual({
      script: draft,
      replaced: [],
    });
    expect(replaceSections(draft, 'No headings here.', ['The turn']).replaced).toEqual([]);
  });
});

describe('a draft checked by walking the beat sheet, not only the headings written', () => {
  const words = (count: number): string => Array.from({ length: count }, () => 'word').join(' ');
  const budget = [
    { section: 'HOOK', words: 100 },
    { section: 'The bill', words: 300 },
    { section: 'The turn', words: 300 },
    { section: 'The end', words: 300 },
  ];
  const section = (heading: string, count: number): string => `## ${heading}\n${words(count)}`;

  test('a beat with no heading in the draft is reported as missing, in beat order', () => {
    const draft = [section('HOOK', 100), section('The bill', 300), section('The end', 100)].join(
      '\n',
    );

    expect(checkDraft(draft, budget)).toEqual({
      stale: false,
      short: [
        { section: 'The turn', words: 0, budget: 300, missing: true },
        { section: 'The end', words: 100, budget: 300 },
      ],
    });
  });

  test('a heading is matched to its beat whatever its case, punctuation or numbering', () => {
    for (const heading of [
      'THE TURN',
      'The turn.',
      'Two: The turn',
      '2. The turn',
      'Beat 2: The turn',
      'The turn: what changed',
      'The Turn — ',
    ]) {
      expect(sameSection(heading, 'The turn'), heading).toBe(true);
    }
    expect(sameSection('The return', 'The turn')).toBe(false);
    expect(sameSection('Two: the bill', 'The turn')).toBe(false);
  });

  test('a heading no name matches is taken by its place when the draft has one section for every beat', () => {
    const draft = [
      section('HOOK', 100),
      section('The bill', 300),
      section('A name of the writer’s own', 100),
      section('The end', 300),
    ].join('\n');

    expect(checkDraft(draft, budget).short).toEqual([
      { section: 'A name of the writer’s own', words: 100, budget: 300 },
    ]);
  });

  test('a draft written from another beat sheet is said to be so, and not judged section by section', () => {
    const draft = [
      section('HOOK', 100),
      section('How it began', 200),
      section('Who paid', 200),
    ].join('\n');

    expect(checkDraft(draft, budget)).toEqual({ stale: true, short: [] });
  });

  test('is not checked without a draft or a budget', () => {
    expect(checkDraft('', budget)).toEqual({ stale: false, short: [] });
    expect(checkDraft(section('HOOK', 100), null)).toEqual({ stale: false, short: [] });
  });

  test('a missing section that comes back is put in its place in the order of the beats', () => {
    const draft = [section('HOOK', 100), section('The bill', 300), section('The end', 300)].join(
      '\n',
    );
    const order = budget.map((line) => line.section);

    const result = replaceSections(draft, `## 2. The turn\n${words(290)}`, ['The turn'], order);

    expect(result.replaced).toEqual(['The turn']);
    expect(sectionWords(result.script)).toEqual([
      { section: 'HOOK', words: 100 },
      { section: 'The bill', words: 300 },
      { section: 'The turn', words: 290 },
      { section: 'The end', words: 300 },
    ]);
  });

  test('a missing first beat goes right after the hook, and a rewritten heading is found by a tolerant name', () => {
    const draft = [section('HOOK', 100), section('The turn', 50), section('The end', 300)].join(
      '\n',
    );
    const rewritten = [section('The Bill', 280), section('Two: the turn', 290)].join('\n');
    const order = budget.map((line) => line.section);

    const result = replaceSections(draft, rewritten, ['The bill', 'The turn'], order);

    expect(sectionWords(result.script)).toEqual([
      { section: 'HOOK', words: 100 },
      { section: 'The bill', words: 280 },
      { section: 'The turn', words: 290 },
      { section: 'The end', words: 300 },
    ]);
  });
});

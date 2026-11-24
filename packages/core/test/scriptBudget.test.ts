import { describe, expect, test } from 'vitest';
import { wordBudget } from '../src/script/budget';

const total = (budget: readonly { readonly words: number }[] | null): number =>
  (budget ?? []).reduce((sum, section) => sum + section.words, 0);

describe('the words each section of a script is written to', () => {
  test('gives the hook its words and shares the rest among the beats by how long each runs', () => {
    // Arrange: a ten-minute script at 150 words a minute, one minute of hook.
    const beats = ['1:00 | The bill | Who pays', '4:00 | The turn | What changed', '7:00 | The end'];

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

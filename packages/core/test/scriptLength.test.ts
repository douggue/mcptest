import { describe, expect, test } from 'vitest';
import {
  MAX_TARGET_SECONDS,
  MAX_TARGET_WORDS,
  MIN_TARGET_SECONDS,
  MIN_TARGET_WORDS,
  lengthProblem,
  parseMinutes,
  secondsForWords,
  wordsForSeconds,
} from '../src/script/length';

describe('a length typed in minutes', () => {
  test('reads minutes, minutes and seconds, and decimals', () => {
    expect(parseMinutes('12')).toBe(720);
    expect(parseMinutes('12:30')).toBe(750);
    expect(parseMinutes(' 12:05 ')).toBe(725);
    expect(parseMinutes('12.5')).toBe(750);
    expect(parseMinutes('0:45')).toBe(45);
  });

  test('is nothing for anything else', () => {
    for (const text of ['', 'abc', '12:60', '12:5', '-3', '1:2:3', '12,5']) {
      expect(parseMinutes(text)).toBeNull();
    }
  });
});

describe('minutes and words kept in step through the speaking rate', () => {
  test('round to the nearest whole word or second', () => {
    expect(wordsForSeconds(750, 153)).toBe(1913); // 1912.5 rounds up
    expect(secondsForWords(1913, 153)).toBe(750); // 750.2 rounds down
    expect(secondsForWords(100, 0)).toBeNull();
  });
});

describe('the bounds of a length', () => {
  test('are 20 seconds to 3 hours, and 50 to 30,000 words', () => {
    expect([MIN_TARGET_SECONDS, MAX_TARGET_SECONDS, MIN_TARGET_WORDS, MAX_TARGET_WORDS]).toEqual([
      20, 10_800, 50, 30_000,
    ]);
    expect(lengthProblem({ seconds: 19, shorts: false })).toMatch(/20 seconds/);
    expect(lengthProblem({ seconds: 10_801, shorts: false })).toMatch(/3 hours/);
    expect(lengthProblem({ seconds: 600, words: 49, shorts: false })).toMatch(/50/);
    expect(lengthProblem({ seconds: 600, words: 30_001, shorts: false })).toMatch(/30,000/);
    expect(lengthProblem({ seconds: 600, words: 1500, shorts: false })).toBeNull();
  });

  test('keep a Short under a minute', () => {
    expect(lengthProblem({ seconds: 60, shorts: true })).toMatch(/under a minute/);
    expect(lengthProblem({ seconds: 50, shorts: true })).toBeNull();
  });
});

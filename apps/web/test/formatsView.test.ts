import { describe, expect, test } from 'vitest';
import { dayMonth, firstSentence, formulaLine } from '../src/lib/formatsView';

describe('a format in brief', () => {
  test('says its numbers in one line, each labelled', () => {
    expect(
      formulaLine({ averageScore: 30.2, scoredCount: 15, videoCount: 15, channelCount: 7 }, 90),
    ).toBe('30× average · 15 videos in 90 days · 7 channels');
    expect(
      formulaLine({ averageScore: 4.25, scoredCount: 3, videoCount: 5, channelCount: 1 }, 30),
    ).toBe('4.3× average of 3 scored · 5 videos in 30 days · 1 channel');
    expect(
      formulaLine({ averageScore: null, scoredCount: 0, videoCount: 1, channelCount: 1 }, 30),
    ).toBe('1 video in 30 days · 1 channel');
  });

  test('keeps the first sentence of a reason and folds the rest', () => {
    expect(firstSentence('It claims a whole industry reacts. The rest is detail.')).toEqual({
      lead: 'It claims a whole industry reacts.',
      rest: 'The rest is detail.',
    });
    expect(firstSentence('One sentence only')).toEqual({ lead: 'One sentence only', rest: '' });
  });

  test('writes a day as day and month', () => {
    expect(dayMonth('2026-11-21T09:00:00.000Z')).toBe('21 Nov');
  });
});

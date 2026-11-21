import { describe, expect, test } from 'vitest';
import { lengthFields, minutesText, rangeNote, readWords } from '../src/lib/scriptLength';

describe('the two length fields', () => {
  test('show the length as minutes and seconds, and the words at the rate', () => {
    expect(minutesText(750)).toBe('12:30');
    expect(minutesText(45)).toBe('0:45');
    expect(lengthFields(750, 153, null)).toEqual({ minutes: '12:30', words: '1913' });
  });

  test('show the words typed when words were typed last', () => {
    expect(lengthFields(706, 153, { typed: 'words', words: 1800 })).toEqual({
      minutes: '11:46',
      words: '1800',
    });
  });

  test('show no words without a rate, and nothing without a length', () => {
    expect(lengthFields(600, null, null)).toEqual({ minutes: '10:00', words: '' });
    expect(lengthFields(null, 150, null)).toEqual({ minutes: '', words: '' });
  });
});

describe('words typed', () => {
  test('are a whole number, with commas and spaces allowed', () => {
    expect(readWords('1,800')).toBe(1800);
    expect(readWords(' 2 500 ')).toBe(2500);
    expect(readWords('12.5')).toBeNull();
    expect(readWords('many')).toBeNull();
  });
});

describe('the quiet line beside a length', () => {
  const range = { minSeconds: 956, maxSeconds: 2137, typicalSeconds: 1342, videos: 60 };

  test('says nothing inside the winners’ range and says which way outside it', () => {
    expect(rangeNote(1200, range)).toBe('');
    expect(rangeNote(600, range)).toBe(
      'Shorter than the winners on this map, which run 15:56 to 35:37.',
    );
    expect(rangeNote(2400, range)).toBe(
      'Longer than the winners on this map, which run 15:56 to 35:37.',
    );
    expect(rangeNote(600, null)).toBe('');
  });
});

import { describe, expect, test } from 'vitest';
import {
  parseChannelRef,
  parseDuration,
  parseRelativeDate,
  parseShortCount,
} from '../src/sources/parse';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;

describe('parseShortCount', () => {
  test.each([
    ['1.5M', 1_500_000],
    ['228K', 228_000],
    ['9', 9],
    ['1,234 views', 1234],
    ['1.2B', 1_200_000_000],
    ['4.2M views', 4_200_000],
    ['No views', 0],
  ])('reads %s as %d', (raw, expected) => {
    expect(parseShortCount(raw)).toBe(expected);
  });

  test.each(['garbage', '12K watching', '', '1d ago'])('returns null for %j', (raw) => {
    expect(parseShortCount(raw)).toBeNull();
  });
});

describe('parseRelativeDate', () => {
  test.each([
    ['10h ago', 10 / 24, 'hour'],
    ['5 min ago', 5 / 1440, 'hour'],
    ['1d ago', 1, 'day'],
    ['Streamed 3 days ago', 3, 'day'],
    ['2w ago', 14, 'week'],
    ['2 weeks ago', 14, 'week'],
    ['3mo ago', 90, 'month'],
    ['1 month ago', 30, 'month'],
    ['1y ago', 365, 'year'],
  ] as const)('reads %s', (raw, days, precision) => {
    const parsed = parseRelativeDate(raw, NOW);

    expect(parsed?.precision).toBe(precision);
    expect(parsed?.raw).toBe(raw);
    expect((NOW.getTime() - (parsed?.date.getTime() ?? 0)) / DAY_MS).toBeCloseTo(days, 5);
  });

  test('returns null when the text is not a relative date', () => {
    expect(parseRelativeDate('1.5M', NOW)).toBeNull();
    expect(parseRelativeDate('', NOW)).toBeNull();
  });
});

describe('parseDuration', () => {
  test('reads minutes and seconds', () => {
    expect(parseDuration('38:48')).toBe(2328);
  });

  test('reads hours, minutes and seconds', () => {
    expect(parseDuration('1:05:56')).toBe(3956);
  });

  test('returns null for badges that are not durations', () => {
    expect(parseDuration('LIVE')).toBeNull();
  });
});

describe('parseChannelRef', () => {
  test.each([
    '@veritasium',
    'veritasium',
    'https://www.youtube.com/@veritasium',
    'youtube.com/@veritasium/videos',
  ])('reads %s as a handle', (input) => {
    expect(parseChannelRef(input)).toEqual({ kind: 'handle', handle: 'veritasium' });
  });

  test.each([
    'UCHnyfMqiRRG1u-2MsSQLbXA',
    'https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA',
  ])('reads %s as a channel id', (input) => {
    expect(parseChannelRef(input)).toEqual({ kind: 'id', id: 'UCHnyfMqiRRG1u-2MsSQLbXA' });
  });

  test.each(['', '   ', 'a b', 'https://evil.example/@someone', '@x', '../etc/passwd'])(
    'rejects %j',
    (input) => {
      expect(() => parseChannelRef(input)).toThrow(/channel/i);
    },
  );
});

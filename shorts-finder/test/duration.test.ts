import { describe, expect, test } from 'vitest';
import { parseIsoDuration } from '../src/youtube/duration';

describe('parseIsoDuration', () => {
  test.each([
    ['PT42S', 42],
    ['PT1M', 60],
    ['PT1M30S', 90],
    ['PT3M', 180],
    ['PT1H', 3600],
    ['PT1H2M3S', 3723],
    ['PT2H5S', 7205],
    ['P1DT2H', 93_600],
    ['P0D', 0],
    ['PT0S', 0],
  ])('reads %s as %i seconds', (text, seconds) => {
    expect(parseIsoDuration(text)).toBe(seconds);
  });

  test.each(['', 'P', 'PT', '42', 'PT42', 'PT1.5S', 'pt42s', 'PT5S1M', 'P1W', ' PT42S'])(
    'cannot read "%s"',
    (text) => {
      expect(parseIsoDuration(text)).toBeNull();
    },
  );
});

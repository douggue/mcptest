import { describe, expect, test } from 'vitest';
import { LIFT_MIN_WORDS, liftedFrom, longestSharedRun } from '../src/hooks/lift';

const OPENING =
  'The company behind the chain owed more than $1.3 billion with about $2 million in cash it could spend.';

describe('words lifted from a real opening', () => {
  test('are a run of six words or more in the same order', () => {
    expect(LIFT_MIN_WORDS).toBe(6);
  });

  test('are found whatever the capitals and the punctuation between them', () => {
    const written = 'It OWED more than $1.3 Billion, and had about two million left.';

    expect(longestSharedRun(written, OPENING)).toEqual([
      'owed',
      'more',
      'than',
      '1',
      '3',
      'billion',
    ]);
  });

  test('are named with the video they come from, the longest run first', () => {
    const lift = liftedFrom('The firm owed more than $1.3 billion with about $2 million left.', [
      { videoId: 'aaaaaaaaaa1', text: 'Nothing alike here at all.' },
      { videoId: 'bbbbbbbbbb1', text: OPENING },
      { videoId: 'cccccccccc1', text: null },
    ]);

    expect(lift).toEqual({
      videoId: 'bbbbbbbbbb1',
      phrase: 'owed more than 1 3 billion with about 2 million',
      words: 10,
    });
  });

  test('are not claimed for the common stock of the language, or with nothing to compare', () => {
    const written = 'For the first time in years, the lines are gone.';

    expect(
      liftedFrom(written, [{ videoId: 'a', text: 'For the first time in a decade, it rained.' }]),
    ).toBeNull();
    expect(liftedFrom(written, [])).toBeNull();
    expect(longestSharedRun('', OPENING)).toEqual([]);
  });

  test('take the same way of opening in other words as no lift', () => {
    const model = 'Hold a carbon fiber part in your hand and it feels unbreakable.';
    const written = 'Hold a flame to a thin stick and it is gone in seconds.';

    expect(liftedFrom(written, [{ videoId: 'a', text: model }])).toBeNull();
  });
});

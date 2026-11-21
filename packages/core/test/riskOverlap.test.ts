import { describe, expect, test } from 'vitest';
import { LIFT_MIN_WORDS } from '../src/hooks/lift';
import { scriptOverlaps, scriptSentences } from '../src/risk/overlap';

const transcripts = [
  {
    videoId: 'theirvideo1',
    text: 'In nineteen sixty the army quietly built a city under the ice and then simply walked away from it',
  },
  { videoId: 'theirvideo2', text: 'Nothing in common with anything here at all' },
];

describe('scriptSentences', () => {
  test('splits the spoken text into sentences, leaving out headings, cues and check markers', () => {
    const script = [
      '## Opening',
      'The army built a city under the ice. [CHECK: the year]',
      '[B-ROLL: snow]',
      'Then it walked away!',
    ].join('\n');

    expect(scriptSentences(script)).toEqual([
      'The army built a city under the ice.',
      'Then it walked away!',
    ]);
  });
});

describe('scriptOverlaps', () => {
  test('finds each sentence sharing six words or more in a row with a stored transcript, with the full run', () => {
    const script = [
      'Here is a fresh opening line.',
      'Back then the army quietly built a city under the ice and then left.',
      'Six words on their own: nothing else.',
    ].join('\n');

    const overlaps = scriptOverlaps(script, transcripts);

    expect(LIFT_MIN_WORDS).toBe(6);
    expect(overlaps).toEqual([
      {
        id: 'o1',
        sentence: 'Back then the army quietly built a city under the ice and then left.',
        videoId: 'theirvideo1',
        phrase: 'the army quietly built a city under the ice and then',
        words: 11,
      },
    ]);
  });

  test('finds nothing when no run is long enough, or nothing is stored', () => {
    expect(scriptOverlaps('The army built a small town.', transcripts)).toEqual([]);
    expect(scriptOverlaps('The army quietly built a city under the ice.', [])).toEqual([]);
  });
});

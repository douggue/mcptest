import { describe, expect, test } from 'vitest';
import { readableBlocks } from '../src/lib/scriptRead';

describe('a script as the owner reads it', () => {
  test('turns headings, picture cues and spoken lines into blocks', () => {
    const text = [
      '## HOOK',
      '[B-ROLL: Old steel town at dawn | steel town aerial | low hum]',
      '',
      'Inside a plain factory, workers fill boxes.',
    ].join('\n');

    expect(readableBlocks(text)).toEqual([
      { kind: 'heading', text: 'HOOK' },
      {
        kind: 'cue',
        show: 'Old steel town at dawn',
        search: 'steel town aerial',
        sound: 'low hum',
      },
      {
        kind: 'line',
        parts: [{ kind: 'text', text: 'Inside a plain factory, workers fill boxes.' }],
      },
    ]);
  });

  test('marks each fact to check where it sits in the line', () => {
    expect(
      readableBlocks('It stores power for 100 hours [CHECK: the hours claimed]. Most last four.'),
    ).toEqual([
      {
        kind: 'line',
        parts: [
          { kind: 'text', text: 'It stores power for 100 hours' },
          { kind: 'check', what: 'the hours claimed' },
          { kind: 'text', text: '. Most last four.' },
        ],
      },
    ]);
  });

  test('keeps a cue with only what to show, and gives nothing for an empty text', () => {
    expect(readableBlocks('[B-ROLL: A rusted plate]')).toEqual([
      { kind: 'cue', show: 'A rusted plate', search: null, sound: null },
    ]);
    expect(readableBlocks('\n  \n')).toEqual([]);
  });
});

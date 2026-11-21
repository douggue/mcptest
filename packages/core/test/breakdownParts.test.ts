import { describe, expect, test } from 'vitest';
import {
  BREAKDOWN_PARTS,
  BREAKDOWN_WRITTEN_PARTS,
  PROMPT_MARKERS,
  isBreakdownPart,
  markerLines,
  splitMarked,
} from '../src/breakdown/parts';

describe('the parts of a breakdown', () => {
  test('are what Jgtube worked out, then seven parts an AI writes, in the order they are written', () => {
    expect(BREAKDOWN_WRITTEN_PARTS).toEqual([
      'titles',
      'thumbnails',
      'scripts',
      'picture',
      'strategy',
      'plan',
      'master',
    ]);
    expect(BREAKDOWN_PARTS).toEqual(['basis', ...BREAKDOWN_WRITTEN_PARTS]);
  });

  test('are told from anything else by name', () => {
    expect(isBreakdownPart('plan')).toBe(true);
    expect(isBreakdownPart('basis')).toBe(true);
    expect(isBreakdownPart('Plan')).toBe(false);
    expect(isBreakdownPart('toString')).toBe(false);
    expect(isBreakdownPart('')).toBe(false);
  });
});

describe('the lines that mark a ready prompt inside a part', () => {
  test('are fixed, one pair each for the thumbnail prompt, the master prompt and the style lock', () => {
    expect(PROMPT_MARKERS).toEqual({
      thumbnails: 'THUMBNAIL PROMPT',
      master: 'MASTER PROMPT',
      picture: 'STYLE LOCK',
    });
    expect(markerLines('MASTER PROMPT')).toEqual({
      start: '=== MASTER PROMPT START ===',
      end: '=== MASTER PROMPT END ===',
    });
  });
});

describe('splitMarked', () => {
  const { start, end } = markerLines('THUMBNAIL PROMPT');

  test('takes out what stands between the two marker lines, and leaves the rest', () => {
    const text = [
      'IMPROVEMENTS FOR US',
      '- Larger words.',
      '',
      start,
      'A wide photo of [SUBJECT].',
      '',
      'Words on it: [OVERLAY TEXT]',
      end,
      '',
      'That is the prompt.',
    ].join('\n');

    expect(splitMarked(text, 'THUMBNAIL PROMPT')).toEqual({
      marked: 'A wide photo of [SUBJECT].\n\nWords on it: [OVERLAY TEXT]',
      rest: 'IMPROVEMENTS FOR US\n- Larger words.\n\nThat is the prompt.',
    });
  });

  test('reads marker lines with spaces around them, and Windows line ends', () => {
    const text = `Before\r\n  ${start}  \r\nThe prompt.\r\n${end}\r\n`;

    expect(splitMarked(text, 'THUMBNAIL PROMPT')).toEqual({
      marked: 'The prompt.',
      rest: 'Before',
    });
  });

  test.each([
    ['there is no start line', `A prompt.\n${end}`],
    ['there is no end line', `${start}\nA prompt.`],
    ['the end comes before the start', `${end}\nA prompt.\n${start}`],
    ['there are two starts', `${start}\nOne.\n${start}\nTwo.\n${end}`],
    ['there are two ends', `${start}\nOne.\n${end}\nTwo.\n${end}`],
    ['nothing stands between them', `${start}\n   \n${end}`],
    ['the markers are only named inside a sentence', `Put it after ${start} and before ${end}.`],
  ])('finds nothing, and changes nothing, when %s', (_why, text) => {
    expect(splitMarked(text, 'THUMBNAIL PROMPT')).toEqual({ marked: null, rest: text });
  });

  test('does not take one prompt’s markers for another’s', () => {
    const text = `${start}\nA picture.\n${end}`;

    expect(splitMarked(text, 'MASTER PROMPT')).toEqual({ marked: null, rest: text });
  });
});

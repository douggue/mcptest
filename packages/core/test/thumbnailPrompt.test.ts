import { describe, expect, test } from 'vitest';
import { markerLines } from '../src/breakdown/parts';
import {
  MAX_THUMBNAIL_PROMPT_CHARS,
  THUMBNAIL_PROMPT_MARKER,
  parseThumbnailPrompt,
} from '../src/concepts/thumbnailPrompt';

const A = 'aaaaaaaaaaa';
const B = 'bbbbbbbbbbb';
const { start, end } = markerLines(THUMBNAIL_PROMPT_MARKER);

const answer = (
  prompt: string,
  head = `LEARNED FROM: [video:${A}] [video:${B}]\nWHY: Big red words on a dark photo win here.`,
) => [head, start, prompt, end].join('\n');

describe('parseThumbnailPrompt', () => {
  test('lifts the prompt out as written, with the videos it learned from and the reason', () => {
    const parsed = parseThumbnailPrompt(
      answer('A wide photo of [SUBJECT].\nOverlay: [OVERLAY TEXT].'),
    );

    expect(parsed).toEqual({
      prompt: 'A wide photo of [SUBJECT].\nOverlay: [OVERLAY TEXT].',
      why: 'Big red words on a dark photo win here.',
      learnedFrom: [A, B],
    });
  });

  test('reads a reason that is missing as empty, and no videos as none', () => {
    expect(parseThumbnailPrompt(answer('A prompt.', 'Here you go.'))).toEqual({
      prompt: 'A prompt.',
      why: '',
      learnedFrom: [],
    });
  });

  test('does not count a video named inside the prompt as one it learned from', () => {
    const parsed = parseThumbnailPrompt(answer(`Like [video:${B}].`, `LEARNED FROM: [video:${A}]`));

    expect('prompt' in parsed && parsed.learnedFrom).toEqual([A]);
  });

  test.each([
    ['no marker lines', 'LEARNED FROM: none\nA prompt with no markers around it.'],
    ['an opening line and no closing line', `${start}\nA prompt.`],
    ['two prompts', [start, 'One.', end, start, 'Two.', end].join('\n')],
    ['nothing between the lines', [start, '', end].join('\n')],
  ])('refuses an answer with %s: a prompt is never guessed at', (_what, text) => {
    expect(parseThumbnailPrompt(text)).toEqual({
      problem: 'the answer did not hold one prompt between the two marker lines',
    });
  });

  test('refuses a prompt longer than a prompt can sensibly be', () => {
    const parsed = parseThumbnailPrompt(answer('x'.repeat(MAX_THUMBNAIL_PROMPT_CHARS + 1)));

    expect(parsed).toEqual({ problem: 'the prompt is longer than a thumbnail prompt can be' });
  });
});

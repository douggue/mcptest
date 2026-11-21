import { describe, expect, test } from 'vitest';
import { VIDEO_REF_RULE, splitVideoRefs, stripVideoRefs, videoRefIds } from '../src/video/refs';

const A = 'aaaaaaaaaaa';
const B = 'bbbbbbb_b-b';

describe('videoRefIds', () => {
  test('finds each named video once, in the order named', () => {
    const text = `Bold red text wins [video:${A}] and again [video: ${B} ]. Same style: [video:${A}]`;

    expect(videoRefIds(text)).toEqual([A, B]);
  });

  test('takes nothing that is not an id in the fixed form', () => {
    const text = `[video:short] [video:${A}x] video:${A} [Video:${A}] [video:${A}`;

    expect(videoRefIds(text)).toEqual([]);
  });
});

describe('splitVideoRefs', () => {
  test('cuts a text into its words and the videos named in it, in order', () => {
    expect(splitVideoRefs(`Red text wins [video:${A}], white loses [video:${B}].`)).toEqual([
      { text: 'Red text wins ' },
      { videoId: A },
      { text: ', white loses ' },
      { videoId: B },
      { text: '.' },
    ]);
  });

  test('gives the whole text back when no video is named', () => {
    expect(splitVideoRefs('No video here.')).toEqual([{ text: 'No video here.' }]);
    expect(splitVideoRefs('')).toEqual([]);
  });
});

describe('stripVideoRefs', () => {
  test('takes the markers out and closes the gap they leave', () => {
    expect(stripVideoRefs(`Red text wins [video:${A}], white loses [video:${B}] .`)).toBe(
      'Red text wins, white loses.',
    );
    expect(stripVideoRefs(`Seen in [video:${A}] [video:${B}]`)).toBe('Seen in');
  });

  test('keeps line breaks', () => {
    expect(stripVideoRefs(`- one [video:${A}]\n- two`)).toBe('- one\n- two');
  });
});

describe('VIDEO_REF_RULE', () => {
  test('tells an engine the exact form, and that the id must come from a tool', () => {
    expect(VIDEO_REF_RULE).toContain('[video:THE_ID]');
    expect(VIDEO_REF_RULE).toMatch(/a tool gave/);
    expect(VIDEO_REF_RULE).toMatch(/never make one up/i);
  });
});

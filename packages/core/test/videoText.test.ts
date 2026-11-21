import { describe, expect, test } from 'vitest';
import type { StoryboardLevel, TranscriptSegment } from '../src/sources/types';
import { parseVideoRef } from '../src/video/ref';
import {
  STORYBOARD_FRAME_WIDTH,
  chooseLevel,
  describeSheet,
  planSheets,
} from '../src/video/storyboard';
import { TRANSCRIPT_STAMP_SECONDS, clock, formatTranscript } from '../src/video/transcriptText';

describe('parseVideoRef', () => {
  test.each([
    'bArCA8xnLqU',
    ' bArCA8xnLqU ',
    'https://www.youtube.com/watch?v=bArCA8xnLqU',
    'https://www.youtube.com/watch?v=bArCA8xnLqU&t=42s',
    'youtube.com/watch?v=bArCA8xnLqU',
    'https://m.youtube.com/watch?feature=share&v=bArCA8xnLqU',
    'https://youtu.be/bArCA8xnLqU?si=abc',
    'https://www.youtube.com/shorts/bArCA8xnLqU',
    'https://www.youtube.com/embed/bArCA8xnLqU',
    'https://www.youtube.com/live/bArCA8xnLqU',
  ])('reads the video id out of %s', (input) => {
    expect(parseVideoRef(input)).toBe('bArCA8xnLqU');
  });

  test.each([
    'https://evil.example/watch?v=bArCA8xnLqU',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/@somechannel',
    'file:///etc/passwd',
    '../../etc/passwd',
    '',
  ])('refuses %s', (input) => {
    expect(() => parseVideoRef(input)).toThrow(/Not a valid YouTube video id or link/);
  });
});

describe('clock', () => {
  test('writes a moment the way a player shows it', () => {
    expect([clock(0), clock(5400), clock(750_000), clock(3_723_000)]).toEqual([
      '0:00',
      '0:05',
      '12:30',
      '1:02:03',
    ]);
  });
});

/** One caption line every five seconds. */
const captions = (count: number): TranscriptSegment[] =>
  Array.from({ length: count }, (_, n) => ({ startMs: n * 5000, text: `line ${n}` }));

describe('formatTranscript', () => {
  test('marks the time every half minute or so, not on every line', () => {
    const { text, cutAtMs, endsAtMs } = formatTranscript(captions(14), { maxChars: 10_000 });

    expect(TRANSCRIPT_STAMP_SECONDS).toBe(30);
    expect(text.split('\n')).toEqual([
      '[0:00] line 0 line 1 line 2 line 3 line 4 line 5',
      '[0:30] line 6 line 7 line 8 line 9 line 10 line 11',
      '[1:00] line 12 line 13',
    ]);
    expect(cutAtMs).toBeNull();
    expect(endsAtMs).toBe(65_000);
  });

  test('cuts at a time mark when the text is too long, and says where to carry on', () => {
    const { text, cutAtMs } = formatTranscript(captions(60), { maxChars: 120 });

    expect(text.split('\n')).toHaveLength(2);
    expect(text.length).toBeLessThanOrEqual(120);
    expect(cutAtMs).toBe(60_000);
  });

  test('carries on from a given moment', () => {
    const { text, cutAtMs } = formatTranscript(captions(60), { maxChars: 10_000, fromMs: 240_000 });

    expect(text.startsWith('[4:00] line 48')).toBe(true);
    expect(cutAtMs).toBeNull();
  });

  test('always gives the first paragraph, however small the limit', () => {
    const { text, cutAtMs } = formatTranscript(captions(20), { maxChars: 5 });

    expect(text).toBe('[0:00] line 0 line 1 line 2 line 3 line 4 line 5');
    expect(cutAtMs).toBe(30_000);
  });

  test('gives an empty text for no lines, and does not change the lines it was given', () => {
    const lines = captions(3);
    const before = JSON.stringify(lines);

    expect(formatTranscript([], { maxChars: 100 })).toEqual({
      text: '',
      cutAtMs: null,
      endsAtMs: null,
    });
    formatTranscript(lines, { maxChars: 100 });
    expect(JSON.stringify(lines)).toBe(before);
  });
});

const level = (overrides: Partial<StoryboardLevel> = {}): StoryboardLevel => ({
  templateUrl: 'https://i.ytimg.com/sb/bArCA8xnLqU/storyboard3_L2/M$M.jpg?sqp=x&sigh=y',
  frameWidth: 160,
  frameHeight: 90,
  frameCount: 157,
  columns: 5,
  rows: 5,
  intervalMs: 10_000,
  sheetCount: 7,
  ...overrides,
});

describe('chooseLevel', () => {
  const sizes = [48, 80, 160, 320].map((frameWidth) => level({ frameWidth }));

  test('takes the widest frames up to the width aimed for', () => {
    expect(STORYBOARD_FRAME_WIDTH).toBe(160);
    expect(chooseLevel(sizes)?.frameWidth).toBe(160);
    expect(chooseLevel(sizes.slice(0, 2))?.frameWidth).toBe(80);
  });

  test('takes the narrowest when every size is wider, and none when there is none', () => {
    expect(chooseLevel([level({ frameWidth: 640 }), level({ frameWidth: 320 })])?.frameWidth).toBe(
      320,
    );
    expect(chooseLevel([])).toBeNull();
  });
});

describe('planSheets', () => {
  test('spreads the sheets asked for across the video, ends included', () => {
    expect(planSheets(level(), 3).map((sheet) => sheet.index)).toEqual([0, 3, 6]);
    expect(planSheets(level(), 4).map((sheet) => sheet.index)).toEqual([0, 2, 4, 6]);
    expect(planSheets(level(), 1).map((sheet) => sheet.index)).toEqual([3]);
    expect(planSheets(level(), 20).map((sheet) => sheet.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test('says where each sheet is and when its frames were taken', () => {
    const [first, , last] = planSheets(level(), 3);

    expect(first).toEqual({
      index: 0,
      url: 'https://i.ytimg.com/sb/bArCA8xnLqU/storyboard3_L2/M0.jpg?sqp=x&sigh=y',
      columns: 5,
      rows: 5,
      frames: 25,
      intervalMs: 10_000,
      firstFrameMs: 0,
      lastFrameMs: 240_000,
    });
    // 157 frames: the seventh sheet holds the last seven.
    expect(last).toMatchObject({ index: 6, frames: 7, firstFrameMs: 1_500_000 });
    expect(last?.lastFrameMs).toBe(1_560_000);
    expect(last?.url).toContain('/M6.jpg?');
  });

  test('works the interval out from the video’s length for a size that gives none', () => {
    const even = level({ intervalMs: 0, frameCount: 100, columns: 10, rows: 10, sheetCount: 1 });

    expect(planSheets(even, 1, 1554)[0]).toMatchObject({ intervalMs: 15_540, frames: 100 });
    expect(planSheets(even, 1)[0]).toMatchObject({ intervalMs: null, firstFrameMs: null });
  });
});

describe('describeSheet', () => {
  test('explains the grid and the times, so a whole sheet can be read', () => {
    const [first, , last] = planSheets(level(), 3);

    expect(describeSheet(first!, 7)).toBe(
      'Sheet 1 of 7: a grid 5 across and 5 down, in order left to right, then top to bottom. 25 frames, one every 10 seconds, from 0:00 to 4:00.',
    );
    expect(describeSheet(last!, 7)).toBe(
      'Sheet 7 of 7: a grid 5 across and 5 down, in order left to right, then top to bottom. 7 frames (the last 18 places of the grid are empty), one every 10 seconds, from 25:00 to 26:00.',
    );
  });

  test('says so when the times cannot be told', () => {
    const even = level({ intervalMs: 0, frameCount: 100, columns: 10, rows: 10, sheetCount: 1 });

    expect(describeSheet(planSheets(even, 1)[0]!, 1)).toBe(
      'Sheet 1 of 1: a grid 10 across and 10 down, in order left to right, then top to bottom. 100 frames, evenly spaced; their times are not known.',
    );
    expect(describeSheet(planSheets(even, 1, 1554)[0]!, 1)).toContain('one every 15.5 seconds');
  });
});

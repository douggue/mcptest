import { describe, expect, test } from 'vitest';
import type { StoryboardLevel, TranscriptSegment } from '../src/sources/types';
import { parseVideoRef } from '../src/video/ref';
import {
  STORYBOARD_FRAME_WIDTH,
  chooseLevel,
  describeSheet,
  planSheetRun,
  planSheets,
} from '../src/video/storyboard';
import {
  TRANSCRIPT_STAMP_SECONDS,
  clock,
  formatTranscript,
  PACE_SLICE_SECONDS,
  transcriptPace,
  transcriptPaceSpans,
} from '../src/video/transcriptText';

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

describe('planSheetRun', () => {
  test('gives sheets in a row from the one asked for, so a whole video can be walked through', () => {
    expect(planSheetRun(level(), 0, 4).map((sheet) => sheet.index)).toEqual([0, 1, 2, 3]);
    expect(planSheetRun(level(), 4, 4).map((sheet) => sheet.index)).toEqual([4, 5, 6]);
  });

  test('gives nothing past the last sheet or before the first', () => {
    expect(planSheetRun(level(), 7, 4)).toEqual([]);
    expect(planSheetRun(level(), -1, 2).map((sheet) => sheet.index)).toEqual([0, 1]);
    expect(planSheetRun(level(), 2, 0)).toEqual([]);
  });

  test('describes each sheet exactly as the spread-out plan does', () => {
    expect(planSheetRun(level(), 6, 1)).toEqual([planSheets(level(), 3)[2]]);
  });
});

describe('transcriptPace', () => {
  const line = (startMs: number, text: string): TranscriptSegment => ({ startMs, text });

  test('counts the words said and divides by the time from the first line to the last', () => {
    const lines = [
      line(0, 'one two three four five'),
      line(30_000, 'six seven eight nine ten'),
      line(60_000, 'eleven twelve'),
    ];

    expect(transcriptPace(lines)).toEqual({ words: 12, spokenSeconds: 60, wordsPerMinute: 12 });
  });

  test('leaves out sound labels such as [Music], which nobody says', () => {
    const lines = [line(0, '[Music] hello there'), line(120_000, '[Applause] goodbye')];

    expect(transcriptPace(lines)).toMatchObject({ words: 3 });
  });

  test('gives no pace for captions too short to judge, or with no lines at all', () => {
    expect(transcriptPace([line(0, 'hello there'), line(5000, 'bye')])).toEqual({
      words: 3,
      spokenSeconds: 5,
      wordsPerMinute: null,
    });
    expect(transcriptPace([])).toEqual({ words: 0, spokenSeconds: 0, wordsPerMinute: null });
  });

  test('gives no pace for a language written without spaces, where words cannot be counted', () => {
    const lines = [
      line(0, 'これは日本語の字幕でスペースがありません'),
      line(90_000, '最後の行です'),
    ];

    expect(transcriptPace(lines).wordsPerMinute).toBeNull();
  });
});

describe('transcriptPaceSpans', () => {
  const line = (startMs: number, text: string): TranscriptSegment => ({ startMs, text });
  /** One line of `words` words every ten seconds, from 0:00 to `lastSeconds`. */
  const steady = (lastSeconds: number, words: number): TranscriptSegment[] =>
    Array.from({ length: lastSeconds / 10 + 1 }, (_, index) =>
      line(index * 10_000, Array.from({ length: words }, () => 'word').join(' ')),
    );

  test('cuts the video into slices of one minute unless told where to cut', () => {
    expect(PACE_SLICE_SECONDS).toBe(60);
  });

  test('counts the words of each minute and the pace they come to', () => {
    // 0:00 to 2:30, a line of five words every ten seconds: six lines a minute.
    const spans = transcriptPaceSpans(steady(150, 5));

    expect(spans).toEqual([
      { fromSeconds: 0, toSeconds: 60, words: 30, wordsPerMinute: 30 },
      { fromSeconds: 60, toSeconds: 120, words: 30, wordsPerMinute: 30 },
      { fromSeconds: 120, toSeconds: 150, words: 20, wordsPerMinute: 40 },
    ]);
  });

  test('shows where a video speeds up', () => {
    const lines = [...steady(50, 2), ...steady(50, 6).map((l) => line(l.startMs + 60_000, l.text))];

    const [slow, fast] = transcriptPaceSpans(lines);

    expect(slow?.wordsPerMinute).toBe(12);
    expect(fast?.wordsPerMinute).toBeGreaterThan(slow?.wordsPerMinute ?? 0);
  });

  test('cuts where it is told to, so each part of a video has its own pace', () => {
    const spans = transcriptPaceSpans(steady(150, 5), [0, 30, 90]);

    expect(spans.map((span) => [span.fromSeconds, span.toSeconds, span.words])).toEqual([
      [0, 30, 15],
      [30, 90, 30],
      [90, 150, 35],
    ]);
    expect(spans[1]?.wordsPerMinute).toBe(30);
  });

  test('puts the cuts in order, once each, and starts from the beginning', () => {
    const spans = transcriptPaceSpans(steady(150, 5), [90, 30, 90]);

    expect(spans.map((span) => span.fromSeconds)).toEqual([0, 30, 90]);
  });

  test('ignores a cut after the last line, and one that is not a time', () => {
    const spans = transcriptPaceSpans(steady(150, 5), [60, 400, -5, Number.NaN]);

    expect(spans.map((span) => [span.fromSeconds, span.toSeconds])).toEqual([
      [0, 60],
      [60, 150],
    ]);
  });

  test('leaves sound labels out of the count', () => {
    const spans = transcriptPaceSpans([line(0, '[Music] one two'), line(90_000, 'three')]);

    expect(spans[0]?.words).toBe(2);
  });

  test('gives no pace for a stretch too short to say anything about', () => {
    const spans = transcriptPaceSpans([line(0, 'one two three'), line(65_000, 'four five')]);

    expect(spans.at(-1)).toEqual({
      fromSeconds: 60,
      toSeconds: 65,
      words: 2,
      wordsPerMinute: null,
    });
  });

  test('gives no pace for a language written without spaces', () => {
    const spans = transcriptPaceSpans([
      line(0, 'これは日本語の字幕でスペースがありません'),
      line(90_000, '最後の行です'),
    ]);

    expect(spans.every((span) => span.wordsPerMinute === null)).toBe(true);
  });

  test('has nothing to say about an empty transcript', () => {
    expect(transcriptPaceSpans([])).toEqual([]);
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

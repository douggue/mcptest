import { describe, expect, test } from 'vitest';
import {
  CHANGES_SEEN_LINE,
  FRAMES_LOOKED_AT_LINE,
  frameStudyNumbers,
} from '../src/video/studyNumbers';

const study = (...lines: string[]): string =>
  ['Sheet 1, 0:00 to 4:00: a map, then a factory.', '', ...lines].join('\n');

describe('the numbers worked out from a frame study', () => {
  test('rest on two closing lines the study is asked to end with', () => {
    expect(FRAMES_LOOKED_AT_LINE).toBe('FRAMES LOOKED AT');
    expect(CHANGES_SEEN_LINE).toBe('PICTURE CHANGES SEEN');
  });

  test('give the seconds between picture changes from preview frames and the video’s length', () => {
    // 905 seconds over 181 frames: one frame every 5 seconds, 180 gaps spanning 900 seconds.
    // 150 changes over those 900 seconds: one every 6.
    const numbers = frameStudyNumbers(
      study('FRAMES LOOKED AT: 181 of 181', 'PICTURE CHANGES SEEN: 150', 'SOURCE: preview'),
      { source: 'preview', available: 181 },
      905,
    );

    expect(numbers).toEqual({
      framesLookedAt: 181,
      changesSeen: 150,
      gaps: 180,
      secondsPerFrame: 5,
      secondsPerChange: 6,
    });
  });

  test('take one frame a second for frames cut from the file, whatever the video’s length', () => {
    const numbers = frameStudyNumbers(
      study('FRAMES LOOKED AT: 601 of 601', 'PICTURE CHANGES SEEN: 80'),
      { source: 'file', available: 601 },
      null,
    );

    expect(numbers).toMatchObject({ gaps: 600, secondsPerFrame: 1, secondsPerChange: 7.5 });
  });

  test('count only the frames that were looked at', () => {
    const numbers = frameStudyNumbers(
      study('FRAMES LOOKED AT: 91 of 180', 'PICTURE CHANGES SEEN: 45'),
      { source: 'preview', available: 180 },
      900,
    );

    expect(numbers).toMatchObject({ framesLookedAt: 91, gaps: 90, secondsPerChange: 10 });
  });

  test('read numbers written with commas, and lines in any letter case', () => {
    const numbers = frameStudyNumbers(
      study('Frames looked at: 1,200 of 1,200', 'picture changes seen: 1,000'),
      { source: 'file', available: 1200 },
      1200,
    );

    expect(numbers).toMatchObject({ framesLookedAt: 1200, changesSeen: 1000 });
  });

  test('take the closing lines, not an earlier mention of them', () => {
    const numbers = frameStudyNumbers(
      study(
        'PICTURE CHANGES SEEN: 3 on this sheet',
        'FRAMES LOOKED AT: 50 of 50',
        'PICTURE CHANGES SEEN: 20',
      ),
      { source: 'preview', available: 50 },
      500,
    );

    expect(numbers.changesSeen).toBe(20);
  });

  test('work out no pace when the study does not count the changes', () => {
    const numbers = frameStudyNumbers(
      study('FRAMES LOOKED AT: 180 of 180'),
      { source: 'preview', available: 180 },
      900,
    );

    expect(numbers).toEqual({
      framesLookedAt: 180,
      changesSeen: null,
      gaps: 179,
      secondsPerFrame: 5,
      secondsPerChange: null,
    });
  });

  test('take a change at every gap for what it is: the frames are too far apart to see more', () => {
    const numbers = frameStudyNumbers(
      study('FRAMES LOOKED AT: 91 of 91', 'PICTURE CHANGES SEEN: 90'),
      { source: 'preview', available: 91 },
      910,
    );

    expect(numbers).toMatchObject({ changesSeen: 90, gaps: 90, secondsPerChange: 10 });
  });

  test.each([
    ['more changes than there are gaps between the frames', 'PICTURE CHANGES SEEN: 180'],
    ['no change at all', 'PICTURE CHANGES SEEN: 0'],
  ])('work out no pace from a count of %s', (_why, line) => {
    const numbers = frameStudyNumbers(
      study('FRAMES LOOKED AT: 180 of 180', line),
      { source: 'preview', available: 180 },
      900,
    );

    expect(numbers.secondsPerChange).toBeNull();
  });

  test('work out nothing about time for preview frames of a video whose length is not known', () => {
    const numbers = frameStudyNumbers(
      study('FRAMES LOOKED AT: 180 of 180', 'PICTURE CHANGES SEEN: 150'),
      { source: 'preview', available: 180 },
      null,
    );

    expect(numbers).toMatchObject({ secondsPerFrame: null, secondsPerChange: null });
  });

  test('work out nothing from an older study that says nothing of its frames', () => {
    expect(frameStudyNumbers('Maps and factories.', null, 900)).toEqual({
      framesLookedAt: null,
      changesSeen: null,
      gaps: null,
      secondsPerFrame: null,
      secondsPerChange: null,
    });
  });
});

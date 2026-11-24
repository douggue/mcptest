import { expect, test } from 'vitest';
import { handVideo, takeHandedVideo } from '../src/lib/videoHandoff';

test('a handed video fills the link once, and nothing that is not an id is handed', () => {
  expect(takeHandedVideo()).toBe('');
  handVideo('not an id');
  expect(takeHandedVideo()).toBe('');
  handVideo('abcdefghijk');
  expect(takeHandedVideo()).toBe('https://www.youtube.com/watch?v=abcdefghijk');
  expect(takeHandedVideo()).toBe('');
});

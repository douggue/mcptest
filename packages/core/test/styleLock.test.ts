import { describe, expect, test } from 'vitest';
import { markerLines } from '../src/breakdown/parts';
import { liftStyleLock, readStyleLock, styleLockNote } from '../src/breakdown/styleLock';

const FROM = `UC${'b'.repeat(22)}`;
const { start, end } = markerLines('STYLE LOCK');

describe('the style lock a channel uses', () => {
  test('is lifted out of a picture part only from between its marker lines', () => {
    expect(liftStyleLock(`PICTURE STYLE\n- Ink.\n${start}\nSTYLE BLOCK: Ink.\n${end}`)).toBe(
      'STYLE BLOCK: Ink.',
    );
    expect(liftStyleLock('PICTURE STYLE\nNO CONSISTENT STYLE')).toBeNull();
  });

  test('is kept with the channel it came from, and read back the same', () => {
    const note = styleLockNote(FROM, 'STYLE BLOCK: Ink.');

    expect(note.startsWith(`FROM CHANNEL: ${FROM}\n`)).toBe(true);
    expect(readStyleLock(note)).toEqual({ fromChannelId: FROM, text: 'STYLE BLOCK: Ink.' });
  });

  test('read from a text with no source line, gives the text as it stands', () => {
    expect(readStyleLock('STYLE BLOCK: Ink.')).toEqual({
      fromChannelId: null,
      text: 'STYLE BLOCK: Ink.',
    });
  });

  test('refuses a source that is not a channel id', () => {
    expect(() => styleLockNote('not a channel', 'x')).toThrow(/channel id/);
  });
});

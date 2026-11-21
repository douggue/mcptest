import { describe, expect, test } from 'vitest';
import { readEnvText, updateEnvText } from '../src/envFile';

const FAKE_KEY = 'not-a-real-key-0000000000000000';

describe('readEnvText', () => {
  test('reads the assignments and leaves comments out', () => {
    const text = ['# A comment', 'JGTUBE_REGION=US', '', '# YOUTUBE_API_KEY=example', 'A=1'].join(
      '\n',
    );

    expect(readEnvText(text)).toEqual({ JGTUBE_REGION: 'US', A: '1' });
  });

  test('reads quoted values, values with = and Windows line endings', () => {
    const text = 'A=\'C:\\Program Files\\x y\'\r\nB=a=b\r\nC="a#b"\r\n';

    expect(readEnvText(text)).toEqual({ A: 'C:\\Program Files\\x y', B: 'a=b', C: 'a#b' });
  });

  test('reads a missing file as no settings', () => {
    expect(readEnvText(null)).toEqual({});
  });
});

describe('updateEnvText', () => {
  test('changes one value and keeps every other line and comment as it is', () => {
    const before = [
      '# Jgtube settings.',
      '',
      '# The region.',
      'JGTUBE_REGION=US   ',
      'OTHER = "kept as written"  # with its comment',
      '',
    ].join('\n');

    const after = updateEnvText(before, { JGTUBE_REGION: 'CA' });

    expect(after).toBe(
      [
        '# Jgtube settings.',
        '',
        '# The region.',
        'JGTUBE_REGION=CA',
        'OTHER = "kept as written"  # with its comment',
        '',
      ].join('\n'),
    );
  });

  test('puts a new setting under its commented example when there is one', () => {
    const before = ['# Your key.', '# YOUTUBE_API_KEY=paste-your-key-here', '', 'A=1', ''].join(
      '\n',
    );

    const after = updateEnvText(before, { YOUTUBE_API_KEY: FAKE_KEY });

    expect(after.split('\n')).toEqual([
      '# Your key.',
      '# YOUTUBE_API_KEY=paste-your-key-here',
      `YOUTUBE_API_KEY=${FAKE_KEY}`,
      '',
      'A=1',
      '',
    ]);
  });

  test('adds a new setting at the end otherwise, after a line break', () => {
    expect(updateEnvText('A=1', { B: '2' })).toBe('A=1\nB=2\n');
    expect(updateEnvText('A=1\n', { B: '2' })).toBe('A=1\nB=2\n');
  });

  test('removes a cleared setting, every line that sets it, and nothing else', () => {
    const before = ['A=1', 'B=2', '# B=example', 'export B=3', 'C=4', ''].join('\n');

    expect(updateEnvText(before, { B: null })).toBe(['A=1', '# B=example', 'C=4', ''].join('\n'));
    expect(updateEnvText(before, { MISSING: null })).toBe(before);
  });

  test('changes the last of several lines that set one name, which is the one in force', () => {
    const before = ['A=1', 'A=2', ''].join('\n');

    const after = updateEnvText(before, { A: '3' });

    expect(after).toBe(['A=1', 'A=3', ''].join('\n'));
    expect(readEnvText(after)).toEqual({ A: '3' });
  });

  test('keeps Windows line endings', () => {
    const before = '# note\r\nA=1\r\nB=2\r\n';

    expect(updateEnvText(before, { A: '9', C: '3' })).toBe('# note\r\nA=9\r\nB=2\r\nC=3\r\n');
  });

  test('makes the file when there is none', () => {
    expect(updateEnvText(null, { A: '1', B: null })).toBe('A=1\n');
  });

  test.each([
    ['a path with spaces', 'C:\\Program Files\\yt-dlp\\yt-dlp.exe'],
    ['a path with a folder starting with n', 'C:\\new\\tools\\ffmpeg.exe'],
    ['a value with =', 'a=b=c'],
    ['a value with #', 'Gemini #3'],
    ['a value with a space and #', 'a #b'],
    ['a value with a single quote', "it's here"],
    ['a value with a double quote', 'say "hi"'],
    ['a value with both quotes', 'it\'s "x"'],
    ['a value with a backslash and a single quote', "C:\\new folder\\it's"],
    ['a plain value', 'claude,agy,codex'],
  ])('writes %s so that it reads back the same', (_what, value) => {
    const after = updateEnvText('# top\nSETTING=old\n', { SETTING: value });

    expect(readEnvText(after)).toEqual({ SETTING: value });
    expect(after.startsWith('# top\n')).toBe(true);
  });

  test('refuses a value it cannot write, naming the setting and not the value', () => {
    const unwritable = 'all `three` \'kinds\' of "quote"';

    expect(() => updateEnvText('', { SETTING: unwritable })).toThrow(/SETTING/);
    expect(() => updateEnvText('', { SETTING: 'two\nlines' })).toThrow(/SETTING/);
    try {
      updateEnvText('', { SETTING: unwritable });
    } catch (error) {
      expect(String(error)).not.toContain('three');
    }
  });

  test('refuses a name that is not a setting name', () => {
    expect(() => updateEnvText('', { 'BAD NAME': '1' })).toThrow(/name/);
  });
});

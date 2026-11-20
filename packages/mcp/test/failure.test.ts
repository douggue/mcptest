import { describe, expect, test } from 'vitest';
import { ToolFailure, plainMessage } from '../src/failure';

describe('plainMessage', () => {
  test('keeps a sentence written for the reader as it is', () => {
    expect(plainMessage(new ToolFailure('No map has been made yet.'))).toBe(
      'No map has been made yet.',
    );
  });

  test('keeps only the first line, so no stack trace gets through', () => {
    const error = new Error('It broke\n    at run (/srv/app/main.ts:3:1)');

    expect(plainMessage(error)).toBe('It broke');
  });

  test('replaces file paths', () => {
    expect(plainMessage(new Error('cannot open /home/me/data/jgtube.db today'))).toBe(
      'cannot open <path> today',
    );
    expect(plainMessage(new Error('cannot open C:\\Users\\me\\jgtube.db'))).toBe(
      'cannot open <path>',
    );
  });

  test('removes control characters and cuts very long text', () => {
    expect(plainMessage(new Error('a\u0007b\u200ec'))).toBe('a b c');
    expect(plainMessage(new Error('x'.repeat(1000)))).toHaveLength(300);
  });

  test('copes with things that are not errors, and with empty messages', () => {
    expect(plainMessage('just text')).toBe('just text');
    expect(plainMessage(new Error(''))).toBe('Something went wrong.');
    expect(plainMessage(undefined)).toBe('Something went wrong.');
  });
});

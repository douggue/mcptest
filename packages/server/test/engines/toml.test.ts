import { describe, expect, test } from 'vitest';
import { tomlValue } from '../../src/engines/toml';

describe('tomlValue', () => {
  test('writes a string in quotes', () => {
    expect(tomlValue('disabled')).toBe('"disabled"');
    expect(tomlValue('')).toBe('""');
  });

  test('escapes the backslashes of a Windows path, and quotes', () => {
    expect(tomlValue('C:\\Users\\Jo\\jgtube.db')).toBe('"C:\\\\Users\\\\Jo\\\\jgtube.db"');
    expect(tomlValue('say "hi"')).toBe('"say \\"hi\\""');
  });

  test('escapes line breaks, tabs and other control characters', () => {
    expect(tomlValue('a\nb\tc\r')).toBe('"a\\nb\\tc\\r"');
    expect(tomlValue('bell\u0007del\u007f')).toBe('"bell\\u0007del\\u007F"');
    expect(tomlValue('\b\f')).toBe('"\\b\\f"');
  });

  test('leaves other characters as they are', () => {
    expect(tomlValue('café 日本 🚀')).toBe('"café 日本 🚀"');
  });

  test('writes true, false and numbers bare', () => {
    expect(tomlValue(true)).toBe('true');
    expect(tomlValue(false)).toBe('false');
    expect(tomlValue(30)).toBe('30');
    expect(tomlValue(1.5)).toBe('1.5');
  });

  test('refuses a number TOML cannot hold', () => {
    expect(() => tomlValue(Number.NaN)).toThrow(/number/);
    expect(() => tomlValue(Number.POSITIVE_INFINITY)).toThrow(/number/);
  });

  test('writes a list, and a list of lists', () => {
    expect(tomlValue(['a', 'b\\c'])).toBe('["a", "b\\\\c"]');
    expect(tomlValue([])).toBe('[]');
    expect(tomlValue([['a'], [1, true]])).toBe('[["a"], [1, true]]');
  });

  test('writes a table on one line, quoting the keys that need it', () => {
    expect(tomlValue({ JGTUBE_DB_PATH: 'C:\\data\\x.db' })).toBe(
      '{ JGTUBE_DB_PATH = "C:\\\\data\\\\x.db" }',
    );
    expect(tomlValue({ 'a key': 1, 'b-c_9': 'x', '': true })).toBe(
      '{ "a key" = 1, b-c_9 = "x", "" = true }',
    );
    expect(tomlValue({})).toBe('{}');
  });

  test('writes tables inside lists and lists inside tables', () => {
    expect(tomlValue({ args: ['a'], more: { b: false } })).toBe(
      '{ args = ["a"], more = { b = false } }',
    );
  });
});

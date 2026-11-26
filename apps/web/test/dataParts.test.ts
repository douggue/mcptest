import { describe, expect, test } from 'vitest';
import { partsFor, withParts, type DataPart } from '../src/lib/dataParts';
import type { Route } from '../src/lib/routes';

const route = (view: Route['view'], extra: Partial<Route> = {}): Route => ({
  view,
  channelId: null,
  anchor: null,
  ...extra,
});

describe('the slow reads each screen shows', () => {
  test('Today reads only the flow counts', () => {
    expect(partsFor(route('home'), false)).toEqual(['flow']);
  });

  test('a screen that shows none of them reads none', () => {
    expect(partsFor(route('breakouts'), false)).toEqual([]);
    expect(partsFor(route('settings'), false)).toEqual([]);
  });

  test('Ideas reads the concepts, hooks, formulas and transfers it shows', () => {
    expect(partsFor(route('ideas'), false)).toEqual(['concepts', 'hooks', 'formulas', 'transfers']);
  });

  test("a channel page's tabs read what each shows", () => {
    expect(partsFor(route('channel', { channelId: 'UCa', tab: 'thumbnails' }), false)).toEqual([
      'board',
    ]);
    expect(partsFor(route('channel', { channelId: 'UCa', tab: 'breakdown' }), false)).toEqual([
      'niches',
    ]);
    expect(partsFor(route('channel', { channelId: 'UCa' }), false)).toEqual([]);
  });

  test("a video's Hook tab reads the hook library", () => {
    expect(partsFor(route('video', { videoId: 'abcdefghijk', tab: 'hook' }), false)).toEqual([
      'hooks',
    ]);
  });

  test('the Ask panel open reads the answers kept, on any screen', () => {
    expect(partsFor(route('breakouts'), true)).toEqual(['answers']);
    expect(partsFor(route('ask'), false)).toEqual(['answers']);
  });
});

describe('the parts wanted so far', () => {
  test('grow with each new screen and keep what was there', () => {
    const first: ReadonlySet<DataPart> = new Set(['flow']);

    expect([...withParts(first, ['board'])]).toEqual(['flow', 'board']);
  });

  test('stay the same set when nothing is new, so nothing is read again', () => {
    const wanted: ReadonlySet<DataPart> = new Set(['flow', 'board']);

    expect(withParts(wanted, ['board'])).toBe(wanted);
    expect(withParts(wanted, [])).toBe(wanted);
  });
});

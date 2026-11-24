import { describe, expect, test } from 'vitest';
import {
  MAX_SEARCH_CHARS,
  channelOfHandle,
  matchChannels,
  type SearchChannel,
} from '../src/channel/search';

const channel = (
  id: string,
  title: string,
  subscribers: number | null = 1000,
  handle: string | null = null,
): SearchChannel => ({ id, title, handle, subscribers });

describe('the channels a few letters match', () => {
  const channels = [
    channel('a', 'Deep Steel Works', 500),
    channel('b', 'Steel Daily', 90_000),
    channel('c', 'Steelyard', 2_000_000),
    channel('d', 'Unrelated', 10, '@steelfan'),
    channel('e', 'Other', null),
    channel('b', 'Steel Daily', 90_000),
  ];

  test('lists a name that starts with them first, then a word that does, then the rest', () => {
    expect(matchChannels('steel', channels).map((each) => each.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(matchChannels('eel', channels).map((each) => each.id)).toEqual(['c', 'b', 'a', 'd']);
  });

  test('ignores case, lists a channel once and keeps to the limit', () => {
    expect(matchChannels('  STEEL ', channels, 2).map((each) => each.id)).toEqual(['c', 'b']);
    expect(matchChannels('@steelfan', channels).map((each) => each.id)).toEqual(['d']);
  });

  test('is empty for a single letter, an endless text or no match', () => {
    expect(matchChannels('s', channels)).toEqual([]);
    expect(matchChannels('zzz', channels)).toEqual([]);
    expect(matchChannels('s'.repeat(MAX_SEARCH_CHARS + 1), channels)).toEqual([]);
  });

  test('finds the channel a handle names, with or without its @', () => {
    expect(channelOfHandle('SteelFan', channels)?.id).toBe('d');
    expect(channelOfHandle('@steelfan', channels)?.id).toBe('d');
    expect(channelOfHandle('nobody', channels)).toBeNull();
  });
});

import type { BankVideo } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import {
  channelMeta,
  channelOfHandle,
  linkTarget,
  matchChannels,
  searchable,
  videoHit,
  type SearchChannel,
} from '../src/lib/search';

const ID = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const channel = (
  id: string,
  title: string,
  subscribers: number | null = 1000,
  handle: string | null = null,
): SearchChannel => ({ id, title, handle, subscribers });

describe('a pasted link', () => {
  test('names a video from a watch, short, shorts, embed or live link', () => {
    const video = { kind: 'video', videoId: 'dQw4w9WgXcQ' };
    for (const link of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s',
      'youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'youtu.be/dQw4w9WgXcQ?si=abc',
      'https://m.youtube.com/shorts/dQw4w9WgXcQ',
      'www.youtube.com/embed/dQw4w9WgXcQ',
      '  https://www.youtube.com/live/dQw4w9WgXcQ  ',
    ]) {
      expect(linkTarget(link)).toEqual(video);
    }
  });

  test('names a channel by its id, from a link or alone', () => {
    const target = { kind: 'channel', channelId: ID };
    expect(linkTarget(`https://www.youtube.com/channel/${ID}`)).toEqual(target);
    expect(linkTarget(`youtube.com/channel/${ID}/videos`)).toEqual(target);
    expect(linkTarget(ID)).toEqual(target);
  });

  test('names a channel by its @handle, from a link or alone', () => {
    const target = { kind: 'handle', handle: 'some.channel' };
    expect(linkTarget('https://www.youtube.com/@some.channel')).toEqual(target);
    expect(linkTarget('youtube.com/@some.channel/videos')).toEqual(target);
    expect(linkTarget('@some.channel')).toEqual(target);
  });

  test('is not read into plain words, other sites or broken links', () => {
    for (const text of [
      '',
      'competitors',
      'steel bridge',
      'abcdefghijk',
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'https://example.com/@some.channel',
      'https://www.youtube.com/',
      'youtube.com',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/channel/not-an-id',
      'https://www.youtube.com/feed/trending',
      '@x',
      'https://youtu.be/dQw4w9WgXcQ and more',
      `https://www.youtube.com/watch?v=dQw4w9WgXcQ&${'x'.repeat(200)}`,
    ]) {
      expect(linkTarget(text)).toBeNull();
    }
  });
});

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

  test('is empty for a single letter or no match', () => {
    expect(matchChannels('s', channels)).toEqual([]);
    expect(matchChannels('zzz', channels)).toEqual([]);
  });

  test('finds the stored channel a handle names', () => {
    expect(channelOfHandle('SteelFan', channels)?.id).toBe('d');
    expect(channelOfHandle('@steelfan', channels)?.id).toBe('d');
    expect(channelOfHandle('nobody', channels)).toBeNull();
  });

  test('says how big a channel is under its name', () => {
    expect(channelMeta(channel('a', 'A', 1500))).toBe('1.5K subscribers');
    expect(channelMeta(channel('a', 'A', null))).toBe('Channel');
  });
});

describe('a stored video in the results', () => {
  const video = (score: number | null): BankVideo =>
    ({
      videoId: 'dQw4w9WgXcQ',
      title: 'A title',
      views: 941_000,
      score,
      channel: { title: 'A channel' },
    }) as BankVideo;

  test('carries its channel, its views and its score when it has one', () => {
    expect(videoHit(video(269))).toEqual({
      videoId: 'dQw4w9WgXcQ',
      title: 'A title',
      channelTitle: 'A channel',
      meta: '269× · 941K views',
    });
    expect(videoHit(video(null)).meta).toBe('941K views');
  });
});

describe('words worth searching for', () => {
  test('are two letters or more, and not a link', () => {
    expect(searchable('st')).toBe(true);
    expect(searchable(' s ')).toBe(false);
    expect(searchable('https://youtu.be/dQw4w9WgXcQ')).toBe(false);
    expect(searchable('x'.repeat(201))).toBe(false);
  });
});

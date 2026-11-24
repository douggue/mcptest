import type { BankVideo } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import {
  channelMeta,
  createSearchApi,
  linkTarget,
  mergeChannels,
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

describe('the channels to list', () => {
  const onScreen = [channel('a', 'Steel Daily', 90_000), channel('b', 'Unrelated', 10)];
  const stored = [channel('c', 'Steelyard', 2_000_000), channel('a', 'Steel Daily', 90_000)];

  test('are the ones on screen at once, then every stored one the server found, each once', () => {
    expect(mergeChannels('steel', onScreen, null).map((each) => each.id)).toEqual(['a']);
    expect(mergeChannels('steel', onScreen, stored).map((each) => each.id)).toEqual(['c', 'a']);
    expect(mergeChannels('s', onScreen, stored)).toEqual([]);
  });

  test('says how big a channel is under its name', () => {
    expect(channelMeta(channel('a', 'A', 1500))).toBe('1.5K subscribers');
    expect(channelMeta(channel('a', 'A', null))).toBe('Channel');
  });
});

describe('the search api', () => {
  const answering = (data: unknown, calls: string[]) =>
    createSearchApi(async (path) => {
      calls.push(String(path));
      return new Response(JSON.stringify({ success: true, data, error: null }), {
        headers: { 'content-type': 'application/json' },
      });
    });

  test('asks the server for every stored channel the words match', async () => {
    const calls: string[] = [];
    const found = [channel('a', 'Steel Daily')];
    const api = answering({ channels: found }, calls);
    expect(await api.channels(' steel & co ')).toEqual(found);
    expect(calls).toEqual(['/api/channels/search?q=steel+%26+co']);
  });

  test('asks the server which stored channel a link names', async () => {
    const calls: string[] = [];
    const api = answering({ channel: null }, calls);
    expect(await api.findChannel('https://www.youtube.com/@some.channel')).toBeNull();
    expect(calls).toEqual([
      '/api/channels/find?channel=https%3A%2F%2Fwww.youtube.com%2F%40some.channel',
    ]);
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

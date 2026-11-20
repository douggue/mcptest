import type { SameTopicChannel, SameTopicList } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApi } from '../src/lib/api';
import { describeOtherAlphabet, describeSameTopic } from '../src/lib/sameTopic';

const cid = (n: number) => `UC${String(n).padStart(22, '0')}`;

const channel = (n: number): SameTopicChannel => ({
  id: cid(n),
  title: `Channel ${n}`,
  handle: null,
  subscribers: 1000 * n,
  titleMatch: 0.1,
  recentViews: 5000,
  recentUploads: 3,
  breakout: null,
  recentTitles: [],
});

const listOf = (count: number, overrides: Partial<SameTopicList> = {}): SameTopicList => ({
  mapId: 7,
  centerId: cid(0),
  minTitleMatch: 0.14,
  channels: Array.from({ length: count }, (_, index) => channel(index + 1)),
  kept: [],
  otherAlphabet: 0,
  ...overrides,
});

describe('describeSameTopic', () => {
  test('says the channels fit on size and pace but use different words, and who decides', () => {
    const text = describeSameTopic(listOf(12), 'America Invents');

    expect(text).toContain('12 channels on this map fit America Invents on size and pace');
    expect(text).toContain('use different words');
    expect(text).toContain('You decide, or your Claude does through the connector');
  });

  test('counts one channel as one', () => {
    expect(describeSameTopic(listOf(1), 'Centre')).toContain('1 channel on this map fits Centre');
  });

  test('says so when every such channel has been decided', () => {
    const text = describeSameTopic(listOf(0, { kept: [{ id: cid(9), title: 'Kept' }] }), 'Centre');

    expect(text).toMatch(/^You have decided on every channel/);
  });

  test('says so when the filter left nothing out on wording alone', () => {
    expect(describeSameTopic(listOf(0), 'Centre')).toMatch(/^No channel on this map/);
  });
});

describe('describeOtherAlphabet', () => {
  test('says how many channels are not shown because of their alphabet', () => {
    expect(describeOtherAlphabet(3)).toBe(
      '3 more are written in another alphabet than yours and are not shown.',
    );
    expect(describeOtherAlphabet(1)).toBe(
      '1 more is written in another alphabet than yours and is not shown.',
    );
  });

  test('says nothing when none was left out', () => {
    expect(describeOtherAlphabet(0)).toBeNull();
  });
});

describe('the same-topic API', () => {
  test('reads the list for a channel', async () => {
    const urls: string[] = [];
    const api = createApi(async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ success: true, data: listOf(2), error: null }));
    });

    await expect(api.sameTopic('@america invents')).resolves.toEqual(listOf(2));
    expect(urls).toEqual(['/api/maps/latest/same-topic?channel=%40america%20invents']);
  });

  test('is null when the channel has no map yet', async () => {
    const api = createApi(
      async () =>
        new Response(JSON.stringify({ success: false, data: null, error: 'No map' }), {
          status: 404,
        }),
    );

    await expect(api.sameTopic(cid(1))).resolves.toBeNull();
  });

  test('raises the server message when the list cannot be read', async () => {
    const api = createApi(
      async () =>
        new Response(JSON.stringify({ success: false, data: null, error: 'Not a channel' }), {
          status: 400,
        }),
    );

    await expect(api.sameTopic('??')).rejects.toThrow(/Not a channel/);
  });
});

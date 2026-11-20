import type { SameTopicList, YouTubeSource } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { createEngine } from '../src/engine';
import { JobStore } from '../src/jobs';
import { CHANNEL_ID, HOST, get, post, read, stubEngine } from './support';

const PATH = '/api/maps/latest/same-topic';

const list: SameTopicList = {
  mapId: 7,
  centerId: CHANNEL_ID,
  minTitleMatch: 0.14,
  channels: [],
  kept: [],
  otherAlphabet: 0,
};

function appWith(found: SameTopicList | null, lookups: string[] = []) {
  const engine = stubEngine({
    findSameTopic: (channel) => {
      lookups.push(channel);
      return found;
    },
  });
  return createApp({ engine, jobs: new JobStore(), allowedHosts: [HOST] });
}

describe('the same-topic list with the real engine and store', () => {
  const NOW = new Date('2026-11-20T12:00:00Z');
  const cid = (letter: string) => `UC${letter.repeat(22)}`;
  const vid = (letter: string, n: number) => letter.repeat(10) + String(n);
  /** B covers the centre's subject in other words; A uses the centre's own. */
  const titles = (letter: string, n: number): string =>
    letter === 'B'
      ? ['Inside a shipyard at night', 'Why this bridge will outlast us', 'Rails and a tunnel'][n]!
      : `America just built machine number ${n}`;
  const source: YouTubeSource = {
    resolveChannelId: async () => cid('C'),
    fetchChannel: async (channelId) => ({
      channel: {
        id: channelId,
        title: `Channel ${channelId.charAt(2)}`,
        handle: `handle${channelId.charAt(2)}`,
        subscribers: 1500,
        subscribersHidden: false,
        videoCount: 3,
      },
      videos: [0, 1, 2].map((n) => ({
        id: vid(channelId.charAt(2), n),
        channelId,
        title: titles(channelId.charAt(2), n),
        views: 1000 * (n + 1),
        durationSeconds: 900,
        published: {
          date: new Date(NOW.getTime() - (n + 1) * 86_400_000),
          precision: 'day' as const,
          raw: `${n + 1}d ago`,
        },
      })),
    }),
    fetchVideoPage: async () => {
      throw new Error('fetchVideoPage is not used in this test');
    },
    getSidebar: async (videoId) =>
      (videoId.startsWith('C') ? ['A', 'B'] : []).map((letter) => ({
        videoId: vid(letter, 0),
        title: `Video by ${letter}`,
        channelId: cid(letter),
        channelName: `Channel ${letter}`,
        channelHandle: null,
        views: 1000,
        published: null,
      })),
  };

  test('lists the channel left out on titles, until the owner keeps it', async () => {
    const real = createEngine(
      { dbPath: ':memory:', region: 'US' },
      { createSource: async () => source, now: () => NOW },
    );
    const live = createApp({ engine: real, jobs: new JobStore(), allowedHosts: [HOST] });
    const listed = async () =>
      (await read<SameTopicList>(await get(live, `${PATH}?channel=%40handleC`))).data;

    expect((await get(live, `${PATH}?channel=%40handleC`)).status).toBe(404);
    await real.crawl('@handleC', 1, () => {});

    const before = await listed();
    expect(before.channels.map((channel) => channel.title)).toEqual(['Channel B']);
    expect(before.channels[0]?.recentTitles[0]?.title).toBe('Inside a shipyard at night');

    await post(live, '/api/competitors', { center: cid('C'), channel: cid('B'), status: 'kept' });

    expect(await listed()).toMatchObject({
      channels: [],
      kept: [{ id: cid('B'), title: 'Channel B' }],
    });
    real.close();
  });
});

describe('GET /api/maps/latest/same-topic', () => {
  test('returns the channels left out on titles in the standard envelope', async () => {
    const lookups: string[] = [];

    const response = await get(appWith(list, lookups), `${PATH}?channel=%40americainvents2`);

    expect(response.status).toBe(200);
    expect(await read(response)).toEqual({ success: true, data: list, error: null, meta: null });
    expect(lookups).toEqual(['@americainvents2']);
  });

  test('answers 404 when no map has been made for the channel', async () => {
    const response = await get(appWith(null), `${PATH}?channel=${CHANNEL_ID}`);

    expect(response.status).toBe(404);
    expect((await read(response)).success).toBe(false);
  });

  test('rejects a channel reference it cannot read, without asking the engine', async () => {
    const lookups: string[] = [];
    const app = appWith(list, lookups);

    expect((await get(app, PATH)).status).toBe(400);
    expect((await get(app, `${PATH}?channel=not%20a%20channel!`)).status).toBe(400);
    expect(lookups).toEqual([]);
  });

  test('only answers to GET, and only to its own address', async () => {
    const app = appWith(list);

    expect((await post(app, `${PATH}?channel=${CHANNEL_ID}`, {})).status).toBe(405);
    expect((await get(app, `${PATH}?channel=${CHANNEL_ID}`, 'evil.example')).status).toBe(403);
  });
});

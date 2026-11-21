import { describe, expect, test } from 'vitest';
import type { StoredVideo, StoredVideoDetails } from '../src/repos/types';
import { describeVideos, type StoredVideoLookup } from '../src/video/facts';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const CHANNEL = `UC${'a'.repeat(22)}`;
const vid = (n: number) => `video${String(n).padStart(6, '0')}`;

const stored = (n: number, views: number): StoredVideo => ({
  id: vid(n),
  channelId: CHANNEL,
  title: `Stored title ${n}`,
  views,
  durationSeconds: 600 + n,
  published: { date: new Date(NOW.getTime() - (5 + n) * DAY_MS), precision: 'day', raw: 'x' },
  fetchedAt: NOW,
});

const details = (n: number, overrides: Partial<StoredVideoDetails> = {}): StoredVideoDetails => ({
  videoId: vid(n),
  title: `Page title ${n}`,
  description: `About video ${n}`,
  tags: ['bread'],
  durationSeconds: 999,
  source: 'web',
  fetchedAt: NOW,
  ...overrides,
});

function lookup(videos: readonly StoredVideo[]): StoredVideoLookup & { lists: number } {
  const store = {
    lists: 0,
    findById: (videoId: string) => videos.find((video) => video.id === videoId) ?? null,
    listByChannel: (channelId: string) => {
      store.lists += 1;
      return videos.filter((video) => video.channelId === channelId);
    },
  };
  return store;
}

describe('describeVideos', () => {
  const channel = [stored(1, 50_000), stored(2, 1000), stored(3, 1000), stored(4, 1000)];

  test('sets each video’s description and tags beside its stored views, length and score', () => {
    const [hit, usual] = describeVideos(lookup(channel), [details(1), details(2)], NOW);

    expect(hit).toMatchObject({
      videoId: vid(1),
      channelId: CHANNEL,
      title: 'Stored title 1',
      description: 'About video 1',
      tags: ['bread'],
      durationSeconds: 601,
      views: 50_000,
    });
    expect(hit?.score).toBeGreaterThan(20);
    expect(usual?.score).toBeLessThan(2);
  });

  test('works a channel’s scores out once, however many of its videos are asked about', () => {
    const store = lookup(channel);

    describeVideos(store, [details(1), details(2), details(3)], NOW);

    expect(store.lists).toBe(1);
  });

  test('gives what the page said for a video no crawl has stored', () => {
    expect(describeVideos(lookup([]), [details(9)], NOW)).toEqual([
      {
        videoId: vid(9),
        channelId: null,
        title: 'Page title 9',
        description: 'About video 9',
        tags: ['bread'],
        durationSeconds: 999,
        views: null,
        score: null,
      },
    ]);
  });
});

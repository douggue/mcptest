import type { MapSnapshot, ProfileVideo } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import {
  channelTabs,
  onMapOf,
  pageVideos,
  profileScore,
  profileVideoMeta,
  relationWords,
} from '../src/lib/channelPage';

const CENTER = 'UC0UJp3kmO7wf33XFf56gbTw';
const OTHER = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const video = (videoId: string, score: number | null = 3): ProfileVideo => ({
  videoId,
  title: `Video ${videoId}`,
  views: 941_000,
  ageDays: 8,
  publishedRaw: '8 days ago',
  durationSeconds: 600,
  score,
});
const map = (channels: readonly Record<string, unknown>[]) =>
  ({ center: { id: CENTER, title: 'Mine' }, channels }) as unknown as Pick<
    MapSnapshot,
    'center' | 'channels'
  >;

describe('a channel’s page', () => {
  test('has four tabs, each at its own address, with how many videos are stored', () => {
    expect(channelTabs(OTHER, 186)).toEqual([
      { key: 'overview', label: 'Overview', href: `#/channel/${OTHER}` },
      { key: 'videos', label: 'Videos', href: `#/channel/${OTHER}/videos`, count: '186' },
      { key: 'thumbnails', label: 'Thumbnails', href: `#/channel/${OTHER}/thumbnails` },
      { key: 'breakdown', label: 'Breakdown', href: `#/channel/${OTHER}/breakdown` },
    ]);
    expect(channelTabs(OTHER, null)[1]).not.toHaveProperty('count');
  });

  test('says how the channel sits on the owner’s map', () => {
    const competitor = onMapOf(
      OTHER,
      map([{ id: OTHER, peer: true, removed: false, tier: 'close' }]),
    );
    expect(competitor).toEqual({
      competitor: true,
      closeness: 'close',
      center: { id: CENTER, title: 'Mine' },
    });
    expect(competitor && relationWords(competitor)).toBe('competitor of');
    const removed = onMapOf(OTHER, map([{ id: OTHER, peer: true, removed: true, tier: 'far' }]));
    expect(removed?.competitor).toBe(false);
    expect(removed && relationWords(removed)).toBe('on the map of');
    const outside = onMapOf(
      OTHER,
      map([{ id: OTHER, peer: false, removed: false, tier: 'medium' }]),
    );
    expect(outside?.competitor).toBe(false);
  });

  test('says nothing of a channel that is not on the map, or when there is no map', () => {
    expect(onMapOf(OTHER, map([]))).toBeNull();
    expect(onMapOf(OTHER, null)).toBeNull();
  });

  test('lists its outliers, then the newest of the rest, each once', () => {
    const top = [video('a', 40), video('b', 12)];
    const recent = [video('c', 1), video('a', 40), video('d', null)];
    const listed = pageVideos({ top, recent });
    expect(listed.outliers.map((each) => each.videoId)).toEqual(['a', 'b']);
    expect(listed.newest.map((each) => each.videoId)).toEqual(['c', 'd']);
  });

  test('writes a video’s line and its score', () => {
    expect(profileVideoMeta(video('a'))).toBe('941K views · 8 days ago');
    expect(profileScore(video('a', 41))).toBe('41×');
    expect(profileScore(video('a', null))).toBeNull();
  });
});

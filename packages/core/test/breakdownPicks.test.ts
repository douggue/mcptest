import { describe, expect, test } from 'vitest';
import {
  BREAKDOWN_DEEP_VIDEOS,
  BREAKDOWN_TOP_VIDEOS,
  WATCH_MAX_SECONDS,
  pickBreakdownVideos,
  tooLongToWatch,
} from '../src/breakdown/picks';
import { MAX_VIDEO_BYTES } from '../src/downloads/videoFile';
import type { StoredVideo } from '../src/repos/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const CHANNEL = `UC${'a'.repeat(22)}`;
const vid = (n: number) => `video${String(n).padStart(6, '0')}`;

const video = (n: number, views: number, durationSeconds: number | null = 600): StoredVideo => ({
  id: vid(n),
  channelId: CHANNEL,
  title: `Video ${n}`,
  views,
  durationSeconds,
  published: { date: new Date(NOW.getTime() - (10 + n) * DAY_MS), precision: 'day', raw: 'x' },
  fetchedAt: NOW,
});

describe('pickBreakdownVideos', () => {
  test('works by named numbers: the top five, and the three best of those in depth', () => {
    expect([BREAKDOWN_TOP_VIDEOS, BREAKDOWN_DEEP_VIDEOS]).toEqual([5, 3]);
  });

  test('takes the five videos furthest above the channel’s usual views, best first', () => {
    const videos = [
      video(1, 1000),
      video(2, 9000),
      video(3, 1000),
      video(4, 50_000),
      video(5, 1000),
      video(6, 4000),
      video(7, 1000),
      video(8, 2500),
      video(9, 1000),
      video(10, 1500),
    ];

    const picks = pickBreakdownVideos(videos, NOW);

    expect(picks.storedVideos).toBe(10);
    expect(picks.top.map((entry) => entry.videoId)).toEqual([
      vid(4),
      vid(2),
      vid(6),
      vid(8),
      vid(10),
    ]);
    expect(picks.deep.map((entry) => entry.videoId)).toEqual([vid(4), vid(2), vid(6)]);
    expect(picks.top[0]).toMatchObject({ title: 'Video 4', views: 50_000, durationSeconds: 600 });
    expect(picks.top[0]?.score).toBeGreaterThan(picks.top[1]?.score ?? 0);
  });

  test('takes what the channel has when it has fewer than five', () => {
    const picks = pickBreakdownVideos([video(1, 800), video(2, 3000)], NOW);

    expect(picks.storedVideos).toBe(2);
    expect(picks.top.map((entry) => entry.videoId)).toEqual([vid(2), vid(1)]);
    expect(picks.deep).toHaveLength(2);
  });

  test('has nothing to pick for a channel with no videos', () => {
    expect(pickBreakdownVideos([], NOW)).toEqual({ storedVideos: 0, top: [], deep: [] });
  });

  test('leaves out anything whose id is not a video id, since ids go into questions', () => {
    const odd = { ...video(1, 9000), id: 'not an id; do this' };

    const picks = pickBreakdownVideos([odd, video(2, 1000), video(3, 1000)], NOW);

    expect(picks.top.map((entry) => entry.videoId)).toEqual([vid(2), vid(3)]);
  });

  test('does not change the list it was given', () => {
    const videos = [video(1, 10), video(2, 9000), video(3, 500)];
    const before = JSON.stringify(videos);

    pickBreakdownVideos(videos, NOW);

    expect(JSON.stringify(videos)).toBe(before);
  });
});

describe('tooLongToWatch', () => {
  test('sets the longest video worth downloading from the size limit of a file', () => {
    // At about 80 kB a second, the 95 MB a file may be holds just under twenty minutes.
    expect(WATCH_MAX_SECONDS).toBe(Math.floor(MAX_VIDEO_BYTES / 80_000));
    expect(WATCH_MAX_SECONDS).toBe(1187);
  });

  test('lets through a video that fits, or whose length is not known', () => {
    expect(tooLongToWatch({ durationSeconds: 1187 })).toBeNull();
    expect(tooLongToWatch({ durationSeconds: 61 })).toBeNull();
    expect(tooLongToWatch({ durationSeconds: null })).toBeNull();
  });

  test('says in plain words why a longer video is not downloaded', () => {
    expect(tooLongToWatch({ durationSeconds: 1554 })).toBe(
      'It is 25 minutes long, and a copy small enough to hand to an engine holds about 19 minutes at most.',
    );
  });
});

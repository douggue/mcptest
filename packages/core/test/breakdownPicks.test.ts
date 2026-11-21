import { describe, expect, test } from 'vitest';
import {
  BREAKDOWN_DEEP_VIDEOS,
  BREAKDOWN_ORDINARY_VIDEOS,
  BREAKDOWN_TITLES,
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
    expect(pickBreakdownVideos([], NOW)).toEqual({
      storedVideos: 0,
      top: [],
      deep: [],
      titles: [],
      ordinary: [],
    });
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

describe('the titles a breakdown studies', () => {
  /** `count` videos whose views fall from the first to the last: video 1 has the most. */
  const falling = (count: number): StoredVideo[] =>
    Array.from({ length: count }, (_, index) => video(index + 1, (count - index) * 1000));

  test('are at least twenty, by a named number', () => {
    expect(BREAKDOWN_TITLES).toBe(20);
  });

  test('are every stored title, most viewed first, when the channel has up to twice twenty', () => {
    const shuffled = [...falling(31)].reverse();

    const { titles } = pickBreakdownVideos(shuffled, NOW);

    expect(titles).toHaveLength(31);
    expect(titles.map((entry) => entry.views)).toEqual(
      [...titles.map((entry) => entry.views)].sort((a, b) => b - a),
    );
    expect(titles[0]).toMatchObject({ videoId: vid(1), views: 31_000, title: 'Video 1' });
    expect(titles.at(-1)).toMatchObject({ videoId: vid(31), views: 1000 });
  });

  test('are the twenty most viewed and the twenty least viewed of a channel with more', () => {
    const { titles } = pickBreakdownVideos(falling(55), NOW);

    expect(titles).toHaveLength(2 * BREAKDOWN_TITLES);
    expect(titles.slice(0, 20).map((entry) => entry.videoId)).toEqual(
      Array.from({ length: 20 }, (_, index) => vid(index + 1)),
    );
    expect(titles.slice(20).map((entry) => entry.videoId)).toEqual(
      Array.from({ length: 20 }, (_, index) => vid(index + 36)),
    );
  });

  test('are all the channel has when it has fewer than twenty', () => {
    const { titles } = pickBreakdownVideos(falling(7), NOW);

    expect(titles.map((entry) => entry.videoId)).toEqual([1, 2, 3, 4, 5, 6, 7].map(vid));
  });

  test('carry the score beside the views, so a new video is not taken for a weak one', () => {
    const { titles } = pickBreakdownVideos(falling(12), NOW);

    expect(titles[0]?.score).toBeGreaterThan(1);
    expect(titles.at(-1)?.score).toBeLessThan(1);
  });

  test('keep videos with the same views in one fixed order', () => {
    const same = [video(3, 500), video(1, 500), video(2, 500)];

    const once = pickBreakdownVideos(same, NOW).titles.map((entry) => entry.videoId);
    const again = pickBreakdownVideos([...same].reverse(), NOW).titles.map(
      (entry) => entry.videoId,
    );

    expect(again).toEqual(once);
  });

  test('leave out anything whose id is not a video id', () => {
    const odd = { ...video(1, 9000), id: 'not an id; do this' };

    const { titles } = pickBreakdownVideos([odd, video(2, 1000)], NOW);

    expect(titles.map((entry) => entry.videoId)).toEqual([vid(2)]);
  });
});

describe('the ordinary videos set beside the top ones', () => {
  test('are up to five that did what the channel usually does or less, newest first', () => {
    const videos = [
      video(1, 90_000),
      video(2, 40_000),
      video(3, 20_000),
      video(4, 9000),
      video(5, 5000),
      ...[6, 7, 8, 9, 10, 11, 12].map((n) => video(n, 1000)),
    ];

    const { ordinary, top } = pickBreakdownVideos(videos, NOW);

    expect(BREAKDOWN_ORDINARY_VIDEOS).toBe(5);
    expect(ordinary).toHaveLength(5);
    expect(ordinary.every((entry) => entry.score !== null && entry.score <= 1.2)).toBe(true);
    expect(ordinary.map((entry) => entry.videoId)).toEqual([6, 7, 8, 9, 10].map(vid));
    const topIds = top.map((entry) => entry.videoId);
    expect(ordinary.some((entry) => topIds.includes(entry.videoId))).toBe(false);
  });

  test('leave out a video too new to have shown that it is ordinary', () => {
    const fresh: StoredVideo = {
      ...video(9, 10),
      published: { date: new Date(NOW.getTime() - DAY_MS), precision: 'day', raw: 'x' },
    };
    const videos = [video(1, 9000), video(2, 1000), video(3, 1000), video(4, 1000), fresh];

    const { ordinary } = pickBreakdownVideos(videos, NOW);

    expect(ordinary.map((entry) => entry.videoId)).not.toContain(vid(9));
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
      'It is 25:54 long, and a copy small enough for Jgtube to download holds about 19:47 at most.',
    );
  });
});

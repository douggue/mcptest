import type { StoredVideo, TeardownReport } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { MAX_OWN_VIDEOS, ownVideosOf } from '../src/formatOwnVideos';

const NOW = new Date('2026-11-24T12:00:00Z');
const video = (id: string, daysAgo: number, views: number): StoredVideo =>
  ({
    id,
    channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
    title: `Video ${id}`,
    views,
    durationSeconds: 600,
    published: { raw: '', date: new Date(NOW.getTime() - daysAgo * 86_400_000) },
    fetchedAt: NOW,
  }) as unknown as StoredVideo;

describe('your own videos for the plan', () => {
  test('newest first, with scores and what a teardown measured', () => {
    const videos = Array.from({ length: MAX_OWN_VIDEOS + 3 }, (_, index) =>
      video(`v${index}`, index + 1, 1000 + index),
    );
    const measured = {
      measured: {
        shots: { cutsPerMinute: 9 },
        palette: {
          items: [
            { hex: '#222222', share: 0.2 },
            { hex: '#111111', share: 0.7 },
          ],
        },
      },
      transcript: { words: { wordsPerMinute: 150 } },
    } as unknown as TeardownReport;
    const own = ownVideosOf({
      now: () => NOW,
      listByChannel: () => videos,
      teardownReport: (id) => (id === 'v0' ? measured : null),
    })('UCaaaaaaaaaaaaaaaaaaaaaa');
    expect(own).toHaveLength(MAX_OWN_VIDEOS);
    expect(own[0]).toMatchObject({
      videoId: 'v0',
      measured: { cutsPerMinute: 9, wordsPerMinute: 150, palette: ['#111111', '#222222'] },
    });
    expect(own[1]?.measured).toBeNull();
    expect(own.some((one) => one.score !== null)).toBe(true);
  });
});

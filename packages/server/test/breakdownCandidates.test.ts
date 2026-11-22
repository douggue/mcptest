import type { StoredBreakdownPart, StoredChannel, StoredVideo } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import {
  CANDIDATE_TOP_VIDEOS,
  breakdownCandidates,
  type CandidateDeps,
} from '../src/breakdownCandidates';

const NOW = new Date('2026-11-21T12:00:00Z');
const DAY = 86_400_000;
const CHANNEL = `UC${'a'.repeat(22)}`;
const QUIET = `UC${'b'.repeat(22)}`;
const MISSING = `UC${'c'.repeat(22)}`;

const channel = (id: string, title: string, hidden = false): StoredChannel => ({
  id,
  title,
  handle: `@${title.toLowerCase()}`,
  subscribers: 12_000,
  subscribersHidden: hidden,
  videoCount: null,
  fetchedAt: NOW,
});

let serial = 0;
const video = (channelId: string, views: number, daysAgo: number): StoredVideo => {
  serial += 1;
  return {
    id: `vid${String(serial).padStart(8, '0')}`,
    channelId,
    title: `Video ${serial}`,
    views,
    durationSeconds: 600,
    published: { date: new Date(NOW.getTime() - daysAgo * DAY), precision: 'day', raw: 'x' },
    fetchedAt: NOW,
  };
};

/** Ten ordinary videos at 1,000 views and, recently, two that broke out. */
const steady = (channelId: string): readonly StoredVideo[] => [
  ...Array.from({ length: 10 }, (_, index) => video(channelId, 1000, 40 + index * 7)),
  video(channelId, 9000, 5),
  video(channelId, 4000, 12),
];

const brokenDown: StoredBreakdownPart = {
  channelId: CHANNEL,
  part: 'titles',
  written: true,
  engine: 'claude',
  text: 'x',
  writtenAt: new Date('2026-10-01T08:00:00Z'),
};
const failedLater: StoredBreakdownPart = {
  channelId: CHANNEL,
  part: 'master',
  written: false,
  reason: 'limit',
  writtenAt: new Date('2026-10-02T08:00:00Z'),
};

function deps(): CandidateDeps {
  const channels = new Map([
    [CHANNEL, channel(CHANNEL, 'Maps')],
    [QUIET, channel(QUIET, 'Quiet', true)],
  ]);
  const videos = new Map([
    [CHANNEL, steady(CHANNEL)],
    [QUIET, [video(QUIET, 500, 200)]],
  ]);
  return {
    channels: { findById: (id) => channels.get(id) ?? null },
    videos: { listByChannel: (id) => videos.get(id) ?? [] },
    brands: {
      find: (id) =>
        id === CHANNEL
          ? {
              channelId: id,
              fetchedAt: NOW,
              description: null,
              avatar: [
                { url: 'https://yt3.googleusercontent.com/logo=s176', width: 176, height: 176 },
              ],
              banner: [],
              keywords: [],
              links: [],
            }
          : null,
    },
    breakdowns: { list: (id) => (id === CHANNEL ? [brokenDown, failedLater] : []) },
    now: () => NOW,
  };
}

describe('the channels offered for a breakdown', () => {
  test('carry the logo, size, recent breakouts, best videos and last breakdown, counted from the store', () => {
    const [maps] = breakdownCandidates(deps(), [CHANNEL]);

    expect(maps).toMatchObject({
      id: CHANNEL,
      title: 'Maps',
      handle: '@maps',
      logoUrl: 'https://yt3.googleusercontent.com/logo=s176',
      subscribers: 12_000,
      storedVideos: 12,
      breakingOut: 2,
      brokenDownAt: '2026-10-02T08:00:00.000Z',
    });
    expect(maps?.top).toHaveLength(CANDIDATE_TOP_VIDEOS);
    expect(maps?.top[0]?.score).toBeGreaterThan(maps?.top[1]?.score ?? 0);
    expect(maps?.recentBest).toBe(maps?.top[0]?.score);
  });

  test('say nothing invented for a quiet channel: hidden subscribers, no breakouts, never broken down', () => {
    const [quiet] = breakdownCandidates(deps(), [QUIET]);

    expect(quiet).toMatchObject({
      subscribers: null,
      logoUrl: null,
      storedVideos: 1,
      breakingOut: 0,
      recentBest: null,
      brokenDownAt: null,
    });
  });

  test('leave out channels that are not stored, and name each channel once in the order asked', () => {
    const found = breakdownCandidates(deps(), [QUIET, MISSING, CHANNEL, QUIET]);

    expect(found.map((entry) => entry.id)).toEqual([QUIET, CHANNEL]);
  });
});

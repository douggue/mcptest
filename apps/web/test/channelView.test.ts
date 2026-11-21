import type { ChannelProfile } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { ApiError } from '../src/lib/api';
import { channelActions, profileTiles, readLine } from '../src/lib/channelView';
import { createExtrasApi } from '../src/lib/extrasApi';

const CHANNEL = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const NOW = new Date('2026-11-21T12:00:00Z');

const profile = (overrides: Partial<ChannelProfile> = {}): ChannelProfile => ({
  id: CHANNEL,
  title: 'Mine',
  handle: 'mine',
  subscribers: 52_000,
  subscribersHidden: false,
  videoCount: 240,
  logoUrl: null,
  readAt: '2026-11-18T12:00:00Z',
  hasMap: true,
  stored: { videos: 100, views: 1_250_000, capped: true },
  uploads: { last30Days: 5, last90Days: 13, perWeek: 1 },
  lastUpload: { ageDays: 3, publishedRaw: '3 days ago' },
  outliers: { minScore: 2, windowDays: 30, all: 9, recent: 2 },
  recent: [],
  top: [],
  ...overrides,
});

describe("a channel's numbers", () => {
  test('are each labelled with what they rest on', () => {
    expect(profileTiles(profile())).toEqual([
      { label: 'Subscribers', value: '52K', note: 'On YouTube' },
      { label: 'Videos', value: '240', note: 'Newest 100 stored' },
      { label: 'Views', value: '1.3M', note: 'Across 100 stored videos' },
      { label: 'Uploads', value: '1 a week', note: '5 in 30 days · 13 in 90' },
      { label: 'Last upload', value: '3 days ago', note: 'Dated by YouTube' },
      {
        label: 'Outliers',
        value: '2',
        note: 'Last 30 days · 9 in all',
        detail: 'Videos at 2× or more of its usual in the last 30 days; 9 among all stored',
      },
    ]);
  });

  test('keep each note short enough for one line of a tile', () => {
    for (const tile of profileTiles(profile())) expect(tile.note.length).toBeLessThanOrEqual(28);
  });

  test('say plainly what is hidden or not stored', () => {
    const tiles = profileTiles(
      profile({
        subscribers: null,
        subscribersHidden: true,
        videoCount: null,
        stored: { videos: 1, views: 10, capped: false },
        uploads: { last30Days: 0, last90Days: 0, perWeek: 0 },
        lastUpload: null,
      }),
    );

    expect(tiles.map((tile) => [tile.label, tile.value, tile.note])).toEqual([
      ['Subscribers', 'Hidden', 'Hidden by the channel'],
      ['Videos', '1', 'Stored; no YouTube total'],
      ['Views', '10', 'Across 1 stored video'],
      ['Uploads', '0 a week', '0 in 30 days · 0 in 90'],
      ['Last upload', '—', 'No videos stored'],
      ['Outliers', '2', 'Last 30 days · 9 in all'],
    ]);
    expect(profileTiles(profile({ subscribers: null }))[0]?.value).toBe('—');
  });

  test('say when the channel was last read', () => {
    expect(readLine(profile(), NOW)).toBe('Read from YouTube 3 days ago.');
  });
});

describe("a channel's buttons into the other views", () => {
  test('with a map, lead to its breakdown, ideas, comments, what changed and alerts', () => {
    expect(channelActions(true).map((action) => [action.label, action.route.view])).toEqual([
      ['Break it down', 'ask'],
      ['Ideas for it', 'ideas'],
      ['What viewers ask for', 'comments'],
      ['What changed', 'what-changed'],
      ['Alerts', 'what-changed'],
    ]);
    expect(channelActions(true).find((action) => action.id === 'alerts')?.route.anchor).toBe(
      'alerts-title',
    );
  });

  test('without one, offer the breakdown and making its map', () => {
    expect(channelActions(false).map((action) => action.id)).toEqual(['breakdown', 'make-map']);
  });
});

describe('the profile API', () => {
  const recording = (data: unknown, status = 200) => {
    const sent: string[] = [];
    const api = createExtrasApi(async (url) => {
      sent.push(String(url));
      return new Response(
        JSON.stringify({ success: status < 400, data, error: status < 400 ? null : 'No' }),
        { status },
      );
    });
    return { api, sent };
  };

  test("reads a channel's profile, and nothing for a channel not stored", async () => {
    const { api, sent } = recording(profile());

    await expect(api.profile(CHANNEL)).resolves.toEqual(profile());
    expect(sent).toEqual([`/api/channels/profile?channel=${CHANNEL}`]);
    await expect(recording(null, 404).api.profile(CHANNEL)).resolves.toBeNull();
    await expect(recording(null, 400).api.profile(CHANNEL)).rejects.toBeInstanceOf(ApiError);
  });
});

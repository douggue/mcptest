import { describe, expect, test } from 'vitest';
import { outsideReason, shapeMismatch, uploadsPerWeek } from '../src/map/peers';
import { anchoredTitleSimilarity } from '../src/map/relevance';
import { buildMapView, type MapMemberData } from '../src/map/view';
import type { StoredVideo } from '../src/repos/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const cid = (letter: string) => `UC${letter.repeat(22)}`;

let counter = 0;
const video = (title: string, daysAgo: number, minutes = 15): StoredVideo => {
  counter += 1;
  return {
    id: `p${String(counter).padStart(10, '0')}`,
    channelId: cid('X'),
    title,
    views: 1000,
    durationSeconds: minutes * 60,
    published: {
      date: new Date(NOW.getTime() - daysAgo * DAY_MS),
      precision: 'day',
      raw: `${daysAgo}d ago`,
    },
    fetchedAt: NOW,
  };
};

const weekly = (title: string, count: number, minutes = 15): StoredVideo[] =>
  Array.from({ length: count }, (_, index) => video(`${title} ${index}`, index * 7 + 1, minutes));

const subject = (subscribers: number | null, videos: StoredVideo[]) => ({ subscribers, videos });
const centre = subject(null, weekly('Centre', 3));

describe('shapeMismatch', () => {
  test('accepts a small channel that publishes at a similar pace and length', () => {
    expect(shapeMismatch(centre, subject(2200, weekly('Twin', 6, 28)), NOW)).toBeNull();
  });

  test('rules out a channel far larger than a peer could be', () => {
    expect(shapeMismatch(centre, subject(15_600_000, weekly('News', 6)), NOW)).toBe('larger');
  });

  test('rules out a channel that publishes many times a day', () => {
    const desk = Array.from({ length: 60 }, (_, index) => video(`Clip ${index}`, index / 10));

    expect(uploadsPerWeek(desk, NOW)).toBe(30);
    expect(shapeMismatch(centre, subject(400_000, desk), NOW)).toBe('cadence');
  });

  test('rules out a channel whose videos are a very different length', () => {
    expect(shapeMismatch(centre, subject(16_000, weekly('Movie', 4, 97)), NOW)).toBe('length');
    expect(shapeMismatch(centre, subject(16_000, weekly('Clip', 4, 3)), NOW)).toBe('length');
  });

  test('does not judge length when the centre has no videos to compare with', () => {
    const empty = subject(null, []);

    expect(shapeMismatch(empty, subject(16_000, weekly('Movie', 4, 97)), NOW)).toBeNull();
  });
});

describe('outsideReason', () => {
  test('reports the shape problem first, then unrelated titles, else nothing', () => {
    expect(outsideReason('larger', 0.9)).toBe('larger');
    expect(outsideReason(null, 0.05)).toBe('titles');
    expect(outsideReason(null, 0.3)).toBeNull();
  });
});

describe('anchoredTitleSimilarity', () => {
  const centreTitles = ['America Just Built a Humanoid Robot Army'];
  const candidates = new Map([
    [
      'twin',
      [
        'America Just Built a Fusion Reactor',
        'This New Invention Could Replace Jet Engines Forever',
      ],
    ],
    [
      'cousin',
      ['This New Invention Could Replace Car Mirrors Forever', 'Germany Battery Breakthrough'],
    ],
    ['news', ['Full Ceremony: Leaders Arrive at the Summit', 'Watch: Press Briefing Live']],
  ]);

  test('lifts a channel that resembles the look-alikes even if it shares little with the centre', () => {
    const alone = anchoredTitleSimilarity(centreTitles, candidates, []);
    const anchored = anchoredTitleSimilarity(centreTitles, candidates, ['twin']);

    expect(alone.scores.get('cousin')).toBe(0);
    expect(anchored.anchors).toEqual(['twin']);
    expect(anchored.scores.get('cousin')).toBeGreaterThan(0.2);
    expect(anchored.scores.get('news')).toBe(0);
  });

  test('uses only channels that share something with the centre as anchors', () => {
    const result = anchoredTitleSimilarity(centreTitles, candidates, ['news', 'cousin']);

    expect(result.anchors).toEqual([]);
  });
});

describe('buildMapView with outsiders', () => {
  const member = (
    letter: string,
    subscribers: number,
    videos: StoredVideo[],
    steps = 1,
  ): MapMemberData => ({
    channel: {
      id: cid(letter),
      title: `Channel ${letter}`,
      handle: null,
      subscribers,
      subscribersHidden: false,
      videoCount: null,
      fetchedAt: NOW,
    },
    steps,
    videos,
  });

  const rows = buildMapView({
    center: member('C', 0, weekly('America Just Built a Robot', 3), 0),
    members: [
      member('N', 15_600_000, weekly('America Just Built a Robot', 6)),
      member('T', 2200, weekly('America Just Built a Reactor', 6)),
      member('U', 5000, weekly('Ten Rifles Ranked Worst to Best', 6)),
    ],
    edges: [],
    now: NOW,
  });
  const byTitle = Object.fromEntries(rows.map((row) => [row.channel.title, row]));

  test('marks only same-kind channels as peers and says why the others are not', () => {
    expect(byTitle['Channel T']).toMatchObject({ peer: true, outsideReason: null });
    expect(byTitle['Channel N']).toMatchObject({ peer: false, outsideReason: 'larger' });
    expect(byTitle['Channel U']).toMatchObject({ peer: false, outsideReason: 'titles' });
  });

  test('lists peers before everything else', () => {
    expect(rows[0]?.channel.title).toBe('Channel T');
  });
});

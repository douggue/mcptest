import { describe, expect, test } from 'vitest';
import { GROWTH_WINDOW_DAYS, viewsGained } from '../src/niches/growth';
import type { VideoReading } from '../src/repos/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const reading = (videoId: string, days: number, views: number): VideoReading => ({
  videoId,
  capturedAt: daysAgo(days),
  views,
});

describe('viewsGained', () => {
  test('is null with no reading, or with the channel read only once', () => {
    expect(viewsGained([], NOW)).toBeNull();
    expect(viewsGained([reading('a', 3, 100), reading('b', 3, 50)], NOW)).toBeNull();
  });

  test('adds up what each video gained between the first and the latest reading', () => {
    const growth = viewsGained(
      [
        reading('a', 10, 1000),
        reading('b', 10, 200),
        reading('a', 5, 1500),
        reading('b', 5, 260),
        reading('a', 1, 4000),
        reading('b', 1, 300),
      ],
      NOW,
    );

    expect(growth).toEqual({ views: 3100, days: 9, since: daysAgo(10).toISOString() });
  });

  test('counts every view of a video first seen after the first reading: it is new since then', () => {
    const growth = viewsGained(
      [reading('old', 6, 500), reading('old', 2, 800), reading('new', 2, 9000)],
      NOW,
    );

    expect(growth?.views).toBe(300 + 9000);
  });

  test('counts nothing for a video that was only seen at the first reading', () => {
    const growth = viewsGained(
      [reading('gone', 6, 5000), reading('kept', 6, 100), reading('kept', 1, 150)],
      NOW,
    );

    expect(growth?.views).toBe(50);
  });

  test('never counts a falling view count as a loss', () => {
    const growth = viewsGained(
      [reading('a', 4, 1000), reading('a', 1, 900), reading('b', 4, 10), reading('b', 1, 40)],
      NOW,
    );

    expect(growth?.views).toBe(30);
  });

  test('looks only at readings from the last 30 days', () => {
    const growth = viewsGained(
      [reading('a', GROWTH_WINDOW_DAYS + 5, 100), reading('a', 20, 1000), reading('a', 2, 1600)],
      NOW,
    );

    expect(growth).toEqual({ views: 600, days: 18, since: daysAgo(20).toISOString() });
    expect(viewsGained([reading('a', 40, 1), reading('a', 2, 900)], NOW)).toBeNull();
  });
});

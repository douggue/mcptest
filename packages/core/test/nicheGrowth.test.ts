import { describe, expect, test } from 'vitest';
import { GROWTH_WINDOW_DAYS, viewsGained } from '../src/niches/growth';
import type { VideoReading } from '../src/repos/types';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

/** A reading taken `days` ago of a video published `publishedDays` ago: long ago unless said. */
const reading = (
  videoId: string,
  days: number,
  views: number,
  publishedDays = 400,
): VideoReading => ({
  videoId,
  capturedAt: daysAgo(days),
  views,
  publishedAt: daysAgo(publishedDays),
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

  test('counts every view of a video published after the first reading: it is new since then', () => {
    const growth = viewsGained(
      [reading('old', 6, 500), reading('old', 2, 800), reading('new', 2, 9000, 4)],
      NOW,
    );

    expect(growth?.views).toBe(300 + 9000);
  });

  test('does not count the lifetime views of an older video that was merely missing at the first reading', () => {
    const growth = viewsGained(
      [reading('old', 6, 500), reading('old', 2, 800), reading('missed', 2, 2_000_000, 300)],
      NOW,
    );

    expect(growth?.views).toBe(300);
  });

  test('counts what an older video gained since it was first seen inside the window', () => {
    const growth = viewsGained(
      [
        reading('old', 6, 500),
        reading('old', 1, 800),
        reading('missed', 4, 2_000_000, 300),
        reading('missed', 1, 2_000_450, 300),
      ],
      NOW,
    );

    expect(growth?.views).toBe(300 + 450);
  });

  test('counts a video published exactly at the first reading as new', () => {
    const growth = viewsGained(
      [reading('old', 6, 500), reading('old', 2, 500), reading('new', 2, 70, 6)],
      NOW,
    );

    expect(growth?.views).toBe(70);
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

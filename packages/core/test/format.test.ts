import { describe, expect, test } from 'vitest';
import {
  formatCount,
  formatMapTable,
  formatScore,
  formatVideoTable,
  sanitize,
} from '../src/format';
import type { MapRow } from '../src/map/view';
import type { VideoReportRow } from '../src/report';

const NOW = new Date('2026-11-20T12:00:00Z');

describe('sanitize', () => {
  test('removes terminal escape sequences from scraped text', () => {
    expect(sanitize('Safe \u001b[31mred\u0007 title')).toBe('Safe  [31mred  title');
  });

  test('removes zero-width and direction-override characters', () => {
    expect(sanitize('abc‮def​ghi')).toBe('abc def ghi');
  });
});

describe('formatScore and formatCount', () => {
  test('show one decimal for small multiples and none for large ones', () => {
    expect(formatScore(7.94)).toBe('7.9x');
    expect(formatScore(1541.7)).toBe('1542x');
  });

  test('mark an unscored video as new and a hidden count with a dash', () => {
    expect(formatScore(null)).toBe('new');
    expect(formatCount(null)).toBe('-');
    expect(formatCount(1_500_000)).toBe('1.5M');
  });
});

describe('formatVideoTable', () => {
  const row = (title: string, score: number | null): VideoReportRow => ({
    id: 'abcdefghijk',
    title,
    views: 84_000,
    ageDays: 1.2,
    publishedRaw: '1d ago',
    score,
    baseline: 54,
  });

  test('prints a header and one line per video up to the limit', () => {
    const lines = formatVideoTable([row('First', 1541.7), row('Second', null)], 1);

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('1542x');
    expect(lines[1]).toContain('84K');
    expect(lines[1]).toContain('First');
  });

  test('cuts long titles and strips unsafe characters', () => {
    const lines = formatVideoTable([row(`\u001b]0;pwned\u0007${'T'.repeat(200)}`, 2)], 5);

    expect(lines[1]).not.toMatch(/[\u0000-\u001f]/);
    expect(lines[1]?.length).toBeLessThan(110);
  });
});

describe('formatMapTable', () => {
  const mapRow = (overrides: Partial<MapRow> = {}): MapRow => ({
    channel: {
      id: 'UCAAAAAAAAAAAAAAAAAAAAAA',
      title: 'Modern Frontier',
      handle: null,
      subscribers: 2100,
      subscribersHidden: false,
      videoCount: 38,
      fetchedAt: NOW,
    },
    steps: 2,
    tier: 'medium',
    relevance: 0.62,
    recommendedBy: [],
    metrics: {
      recentViews: 302_000,
      recentUploads: 20,
      breakout: { videoId: 'abcdefghijk', title: 'Hit', views: 84_000, score: 1541.7 },
      rising: true,
    },
    peer: true,
    outsideReason: null,
    ...overrides,
  });

  test('prints tier, match, size, recent views, best breakout and the rising flag', () => {
    const [, line] = formatMapTable([mapRow()], 10);

    expect(line).toMatch(/^medium\s+62%\s+2\.1K\s+302K\s+1542x\s+rising\s+Modern Frontier$/);
  });

  test('uses dashes where a channel has no subscriber count or breakout', () => {
    const quiet = mapRow({
      channel: { ...mapRow().channel, subscribers: null, subscribersHidden: true },
      metrics: { recentViews: 0, recentUploads: 0, breakout: null, rising: false },
    });

    expect(formatMapTable([quiet], 10)[1]).toMatch(/^medium\s+62%\s+-\s+0\s+-\s+Modern Frontier$/);
  });
});

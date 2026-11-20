import type { MapRow } from './map/view';
import type { VideoReportRow } from './report';

const TITLE_WIDTH = 72;
/**
 * Scraped text is attacker-authored. Control characters could drive a terminal;
 * zero-width and direction-override characters could disguise what is shown.
 */
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function sanitize(text: string): string {
  return text.replace(UNSAFE_CHARACTERS, ' ');
}

export function formatCount(value: number | null): string {
  return value === null ? '-' : compact.format(value);
}

export function formatScore(score: number | null): string {
  if (score === null) return 'new';
  return `${score >= 100 ? Math.round(score) : score.toFixed(1)}x`;
}

const clip = (text: string): string => sanitize(text).slice(0, TITLE_WIDTH);

/** A channel's videos, strongest outlier first. */
export function formatVideoTable(
  rows: readonly VideoReportRow[],
  limit: number,
): readonly string[] {
  const header = ['score'.padStart(8), 'views'.padStart(7), 'age'.padStart(6), 'title'].join('  ');
  const lines = rows
    .slice(0, limit)
    .map((row) =>
      [
        formatScore(row.score).padStart(8),
        formatCount(row.views).padStart(7),
        `${Math.round(row.ageDays)}d`.padStart(6),
        clip(row.title),
      ].join('  '),
    );
  return [header, ...lines];
}

/** The channels around the centre: tier, title match, size, recent views and best breakout. */
export function formatMapTable(rows: readonly MapRow[], limit: number): readonly string[] {
  const header = [
    'tier'.padEnd(6),
    'match'.padStart(5),
    'subs'.padStart(7),
    'recent'.padStart(7),
    'best'.padStart(8),
    ''.padEnd(6),
    'channel',
  ].join('  ');
  const lines = rows
    .slice(0, limit)
    .map((row) =>
      [
        row.tier.padEnd(6),
        `${Math.round(row.relevance * 100)}%`.padStart(5),
        formatCount(row.channel.subscribers).padStart(7),
        formatCount(row.metrics.recentViews).padStart(7),
        (row.metrics.breakout ? formatScore(row.metrics.breakout.score) : '-').padStart(8),
        (row.metrics.rising ? 'rising' : '').padEnd(6),
        clip(row.channel.title),
      ].join('  '),
    );
  return [header, ...lines];
}

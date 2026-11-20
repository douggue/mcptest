import type { ApproxDate, ChannelRef, DatePrecision } from './types';

const COUNT_MULTIPLIERS: Readonly<Record<string, number>> = { '': 1, K: 1e3, M: 1e6, B: 1e9 };
const COUNT_PATTERN = /^(\d[\d.,]*)\s*([KMB]?)(?:\s+views?)?$/i;
/** Scraped fields are short; anything longer is not a count, date or duration. */
const MAX_PARSED_LENGTH = 200;

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;
const MAX_AGE_MS = 100 * DAYS_PER_YEAR * DAY_MS;

const RELATIVE_PATTERN =
  /(?<!\d)(\d{1,4})\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?|s|m|h|d|w|y)\s+ago/i;

const DURATION_PATTERN = /^(?:(\d{1,3}):)?([0-5]?\d):([0-5]\d)$/;

export const CHANNEL_ID_PATTERN = /^UC[\w-]{22}$/;
export const HANDLE_PATTERN = /^[\w.-]{3,30}$/;
export const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]);
const MAX_ECHOED_INPUT = 80;

/** Reads "1.5M", "228K", "1,234 views" or "No views". Returns null for anything else. */
export function parseShortCount(raw: string): number | null {
  if (raw.length > MAX_PARSED_LENGTH) return null;
  const text = raw.trim();
  if (/^no views$/i.test(text)) return 0;
  const match = COUNT_PATTERN.exec(text);
  if (!match) return null;
  const value = Number((match[1] ?? '').replace(/,/g, ''));
  const multiplier = COUNT_MULTIPLIERS[(match[2] ?? '').toUpperCase()];
  if (!Number.isFinite(value) || multiplier === undefined) return null;
  return Math.round(value * multiplier);
}

function unitFor(unit: string): { ms: number; precision: DatePrecision } {
  const lower = unit.toLowerCase();
  if (lower.startsWith('s')) return { ms: SECOND_MS, precision: 'hour' };
  if (lower.startsWith('mo')) return { ms: DAYS_PER_MONTH * DAY_MS, precision: 'month' };
  if (lower.startsWith('m')) return { ms: MINUTE_MS, precision: 'hour' };
  if (lower.startsWith('h')) return { ms: HOUR_MS, precision: 'hour' };
  if (lower.startsWith('d')) return { ms: DAY_MS, precision: 'day' };
  if (lower.startsWith('w')) return { ms: 7 * DAY_MS, precision: 'week' };
  return { ms: DAYS_PER_YEAR * DAY_MS, precision: 'year' };
}

/** Reads "2w ago", "3 days ago" or "Streamed 1 month ago" relative to `now`. */
export function parseRelativeDate(raw: string, now: Date): ApproxDate | null {
  if (raw.length > MAX_PARSED_LENGTH) return null;
  const match = RELATIVE_PATTERN.exec(raw);
  if (!match) return null;
  const { ms, precision } = unitFor(match[2] ?? '');
  const ageMs = Number(match[1]) * ms;
  if (ageMs > MAX_AGE_MS) return null;
  return { date: new Date(now.getTime() - ageMs), precision, raw };
}

/** Reads "38:48" or "1:05:56" as seconds. */
export function parseDuration(raw: string): number | null {
  if (raw.length > MAX_PARSED_LENGTH) return null;
  const match = DURATION_PATTERN.exec(raw.trim());
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  return hours * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function refFromUrl(text: string): ChannelRef | null {
  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const [first, second] = url.pathname.split('/').filter(Boolean);
  if (first === 'channel' && second && CHANNEL_ID_PATTERN.test(second)) {
    return { kind: 'id', id: second };
  }
  if (first?.startsWith('@') && HANDLE_PATTERN.test(first.slice(1))) {
    return { kind: 'handle', handle: first.slice(1) };
  }
  return null;
}

/**
 * Accepts a channel id, a handle (with or without "@") or a youtube.com URL.
 * Anything else is rejected, so no caller-supplied host or path is ever requested.
 */
export function parseChannelRef(input: string): ChannelRef {
  const text = input.trim();
  if (CHANNEL_ID_PATTERN.test(text)) return { kind: 'id', id: text };
  const bare = text.startsWith('@') ? text.slice(1) : text;
  if (HANDLE_PATTERN.test(bare)) return { kind: 'handle', handle: bare };
  const fromUrl = refFromUrl(text);
  if (fromUrl) return fromUrl;
  throw new Error(
    `Not a valid YouTube channel handle, id or URL: "${text.slice(0, MAX_ECHOED_INPUT)}"`,
  );
}

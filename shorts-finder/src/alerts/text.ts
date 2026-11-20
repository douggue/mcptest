/**
 * The small pieces every message is made of: untrusted text made safe for
 * Telegram's HTML, numbers a creator reads at a glance, and a cut that keeps
 * a message under Telegram's limit without breaking its HTML.
 *
 * Titles and channel names come from YouTube and are written by strangers, so
 * nothing from outside is put in a message without `escapeHtml`.
 */
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN } from '../youtube/ids';
import { TELEGRAM_MAX_MESSAGE_LENGTH } from './telegram';

const ELLIPSIS = '…';
const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;
/** Up to this many days an age is told in days; after it, in months. */
const DAYS_TOLD_IN_DAYS = 60;
const BYTES_PER_STEP = 1024;

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/** Makes text safe inside Telegram's HTML, in the body and in an attribute. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (character) => HTML_ENTITIES[character] ?? character);

/**
 * Untrusted text on one line and no longer than `max` characters: line breaks
 * and control characters become spaces, and a cut is marked with "…".
 */
export function capText(text: string, max: number): string {
  const oneLine = text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  const characters = Array.from(oneLine);
  if (characters.length <= max) return oneLine;
  return `${characters
    .slice(0, Math.max(0, max - 1))
    .join('')
    .trimEnd()}${ELLIPSIS}`;
}

/** Untrusted text capped, then escaped: the only way it goes into a message. */
export const safe = (text: string, max: number): string => escapeHtml(capText(text, max));

const COMPACT_STEPS: ReadonlyArray<readonly [number, string]> = [
  [1e3, 'K'],
  [1e6, 'M'],
  [1e9, 'B'],
];

/** 950 as "950", 12,400 as "12.4K", 1,200,000 as "1.2M": how YouTube itself shows counts. */
export function compactNumber(value: number): string {
  const whole = Math.round(value);
  if (Math.abs(whole) < 1000) return String(whole);
  for (const [size, letter] of COMPACT_STEPS) {
    const scaled = whole / size;
    const rounded = Math.abs(scaled) >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
    if (Math.abs(rounded) < 1000 || letter === 'B') return `${rounded}${letter}`;
  }
  return String(whole);
}

/** 4321 as "4,321". */
export const wholeNumber = (value: number): string => Math.round(value).toLocaleString('en-US');

/** $0.42, $12.40, and from a hundred dollars up no cents: $1,240. */
export function dollars(value: number): string {
  if (value >= 100) return `$${wholeNumber(value)}`;
  return `$${value.toFixed(2)}`;
}

/** A rate per 1,000 views: $0.10. */
export const rateDollars = (value: number): string => `$${value.toFixed(2)}`;

const plural = (count: number, unit: string): string => `${count} ${unit}${count === 1 ? '' : 's'}`;

/** How long ago `from` was, in the largest unit that fits: "5 hours", "3 days", "2 months". */
export function ageInWords(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / MS_PER_MINUTE));
  if (minutes < MINUTES_PER_HOUR) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < 2 * HOURS_PER_DAY) return plural(hours, 'hour');
  const days = Math.floor(hours / HOURS_PER_DAY);
  if (days <= DAYS_TOLD_IN_DAYS) return plural(days, 'day');
  if (days < DAYS_PER_YEAR) return plural(Math.floor(days / DAYS_PER_MONTH), 'month');
  return plural(Math.floor(days / DAYS_PER_YEAR), 'year');
}

/** A file's size: "512 bytes", "340 KB", "12.4 MB". */
export function sizeInWords(bytes: number): string {
  if (bytes < BYTES_PER_STEP) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB'];
  let scaled = bytes / BYTES_PER_STEP;
  let unit = 0;
  while (scaled >= BYTES_PER_STEP && unit < units.length - 1) {
    scaled /= BYTES_PER_STEP;
    unit += 1;
  }
  const shown = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  return `${shown} ${units[unit] ?? 'GB'}`;
}

/** The address of a Short, or null when the id is not shaped like a video id. */
export const shortsUrl = (videoId: string): string | null =>
  VIDEO_ID_PATTERN.test(videoId) ? `https://www.youtube.com/shorts/${videoId}` : null;

/** The address of a channel, or null when the id is not shaped like a channel id. */
export const channelUrl = (channelId: string): string | null =>
  CHANNEL_ID_PATTERN.test(channelId) ? `https://www.youtube.com/channel/${channelId}` : null;

/** A link when there is an address to link to; the words alone when there is not. */
export const link = (url: string | null, words: string): string =>
  url === null ? words : `<a href="${url}">${words}</a>`;

const HTML_PIECE = /<[^>]*>|&[#\w]+;|[\s\S]/gu;

const closersFor = (open: readonly string[]): string =>
  open
    .toReversed()
    .map((tag) => `</${tag}>`)
    .join('');

/** The tags open after a piece: an opening tag is added, a closing one taken off. */
function openAfter(open: readonly string[], piece: string): readonly string[] {
  const tag = /^<(\/?)([a-z]+)/i.exec(piece);
  if (tag === null) return open;
  return tag[1] === '/' ? open.slice(0, -1) : [...open, (tag[2] ?? '').toLowerCase()];
}

/**
 * Cuts a message written in Telegram's HTML to at most `max` characters. The
 * cut never falls inside a tag or an entity such as "&amp;", and every tag
 * left open is closed after it. A message that fits comes back unchanged.
 */
export function truncateHtml(html: string, max: number = TELEGRAM_MAX_MESSAGE_LENGTH): string {
  if (html.length <= max) return html;
  let kept = '';
  let open: readonly string[] = [];
  for (const piece of html.match(HTML_PIECE) ?? []) {
    const next = openAfter(open, piece);
    const length = kept.length + piece.length + ELLIPSIS.length + closersFor(next).length;
    if (length > max) break;
    kept += piece;
    open = next;
  }
  return `${kept.trimEnd()}${ELLIPSIS}${closersFor(open)}`;
}

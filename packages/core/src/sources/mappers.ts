import {
  CHANNEL_ID_PATTERN,
  VIDEO_ID_PATTERN,
  parseDuration,
  parseRelativeDate,
  parseShortCount,
} from './parse';
import type { ApproxDate, ChannelInfo, SidebarItem, VideoItem } from './types';

/**
 * Maps list items from the YouTube client into domain objects.
 *
 * The inputs are untrusted and their shape changes without notice, so every
 * access is guarded and an unreadable item maps to null rather than throwing.
 */

const HANDLE_IN_URL = /@([\w.-]{3,30})/;
const SUBSCRIBERS_TEXT = /^([\d.,]+\s*[KMB]?)\s+subscribers?$/i;
const VIDEO_COUNT_TEXT = /^([\d.,]+\s*[KMB]?)\s+videos?$/i;
const MAX_NODES_WALKED = 5000;
/** Titles and names are attacker-authored; keep stored text to a sane length. */
const MAX_TEXT_LENGTH = 300;

type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function at(node: unknown, ...path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (current, key) => (isRecord(current) ? current[key] : undefined),
    node,
  );
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_TEXT_LENGTH) : null;
}

/** Reads either a plain string or a `{ text }` object. */
export function textOf(value: unknown): string | null {
  return asString(value) ?? asString(at(value, 'text'));
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function rowTexts(item: unknown): readonly (readonly string[])[] {
  return asArray(at(item, 'metadata', 'metadata', 'metadata_rows')).map((row) =>
    asArray(at(row, 'metadata_parts'))
      .map((part) => textOf(at(part, 'text')))
      .filter((text): text is string => text !== null),
  );
}

function firstParsed<T>(texts: readonly string[], parse: (text: string) => T | null): T | null {
  for (const text of texts) {
    const parsed = parse(text);
    if (parsed !== null) return parsed;
  }
  return null;
}

function badgeTexts(item: unknown): readonly string[] {
  return asArray(at(item, 'content_image', 'overlays')).flatMap((overlay) =>
    asArray(at(overlay, 'badges'))
      .map((badge) => textOf(at(badge, 'text')))
      .filter((text): text is string => text !== null),
  );
}

/** Collects every string stored under a `text` key, bounded so a huge page cannot stall us. */
function collectTexts(root: unknown): readonly string[] {
  const found: string[] = [];
  const stack: unknown[] = [root];
  const seen = new WeakSet<object>();
  let walked = 0;
  while (stack.length > 0 && walked < MAX_NODES_WALKED) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null || seen.has(node)) continue;
    seen.add(node);
    walked += 1;
    if (isRecord(node)) {
      const text = asString(node['text']);
      if (text) found.push(text);
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      if (typeof child === 'object' && child !== null) stack.push(child);
    }
  }
  return found;
}

function countFromTexts(texts: readonly string[], pattern: RegExp): number | null {
  return firstParsed(texts, (text) => {
    const match = pattern.exec(text.trim());
    return match ? parseShortCount(match[1] ?? '') : null;
  });
}

export function mapChannel(header: unknown, metadata: unknown): ChannelInfo | null {
  const id = asString(at(metadata, 'external_id'));
  const title = asString(at(metadata, 'title'));
  if (!id || !CHANNEL_ID_PATTERN.test(id) || !title) return null;
  const texts = collectTexts(header);
  const subscribers = countFromTexts(texts, SUBSCRIBERS_TEXT);
  const vanityUrl = asString(at(metadata, 'vanity_channel_url')) ?? '';
  return {
    id,
    title,
    handle: HANDLE_IN_URL.exec(vanityUrl)?.[1] ?? null,
    subscribers,
    subscribersHidden: subscribers === null,
    videoCount: countFromTexts(texts, VIDEO_COUNT_TEXT),
  };
}

interface ItemStats {
  readonly views: number | null;
  readonly published: ApproxDate | null;
}

function statsFrom(texts: readonly string[], now: Date): ItemStats {
  return {
    views: firstParsed(texts, parseShortCount),
    published: firstParsed(texts, (text) => parseRelativeDate(text, now)),
  };
}

function mapLockupVideo(item: JsonRecord, channelId: string, now: Date): VideoItem | null {
  if (item['content_type'] !== 'VIDEO') return null;
  const id = asString(item['content_id']);
  const title = textOf(at(item, 'metadata', 'title'));
  if (!id || !VIDEO_ID_PATTERN.test(id) || !title) return null;
  const rows = rowTexts(item);
  return {
    id,
    channelId,
    title,
    ...statsFrom(rows.at(-1) ?? [], now),
    durationSeconds: firstParsed(badgeTexts(item), parseDuration),
  };
}

function mapLegacyVideo(item: JsonRecord, channelId: string, now: Date): VideoItem | null {
  const id = asString(item['id']) ?? asString(item['video_id']);
  const title = textOf(item['title']);
  if (!id || !VIDEO_ID_PATTERN.test(id) || !title) return null;
  const viewsText = textOf(item['short_view_count']) ?? textOf(item['view_count']) ?? '';
  return {
    id,
    channelId,
    title,
    views: parseShortCount(viewsText),
    published: parseRelativeDate(textOf(item['published']) ?? '', now),
    durationSeconds: parseDuration(textOf(item['duration']) ?? ''),
  };
}

/** Maps one item from a channel's Videos tab, in either the current or the older shape. */
export function mapChannelVideo(item: unknown, channelId: string, now: Date): VideoItem | null {
  if (!isRecord(item)) return null;
  return item['type'] === 'LockupView'
    ? mapLockupVideo(item, channelId, now)
    : mapLegacyVideo(item, channelId, now);
}

/** Maps one recommended video from a watch page's sidebar. */
export function mapSidebarItem(item: unknown, now: Date): SidebarItem | null {
  if (!isRecord(item) || item['content_type'] !== 'VIDEO') return null;
  const videoId = asString(item['content_id']);
  const title = textOf(at(item, 'metadata', 'title'));
  if (!videoId || !VIDEO_ID_PATTERN.test(videoId) || !title) return null;
  const rows = rowTexts(item);
  const owner = at(
    item,
    'metadata',
    'image',
    'renderer_context',
    'command_context',
    'on_tap',
    'payload',
  );
  const channelId = asString(at(owner, 'browseId'));
  const baseUrl = asString(at(owner, 'canonicalBaseUrl')) ?? '';
  return {
    videoId,
    title,
    channelId: channelId && CHANNEL_ID_PATTERN.test(channelId) ? channelId : null,
    channelName: rows.length > 1 ? (rows[0]?.[0] ?? null) : null,
    channelHandle: HANDLE_IN_URL.exec(baseUrl)?.[1] ?? null,
    // With a single row there is no way to tell a channel name from the stats.
    ...statsFrom(rows.length > 1 ? (rows.at(-1) ?? []) : [], now),
  };
}

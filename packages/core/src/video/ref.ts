import { VIDEO_ID_PATTERN } from '../sources/parse';

const YOUTUBE_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
]);
const SHORT_LINK_HOST = 'youtu.be';
/** The first part of a path that is followed by a video id. */
const ID_PATHS: ReadonlySet<string> = new Set(['shorts', 'embed', 'live']);
const MAX_ECHOED_INPUT = 80;

function idFromUrl(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  const [first, second] = url.pathname.split('/').filter(Boolean);
  if (host === SHORT_LINK_HOST) return first ?? null;
  if (!YOUTUBE_HOSTS.has(host)) return null;
  if (first === 'watch') return url.searchParams.get('v');
  return first !== undefined && ID_PATHS.has(first) ? (second ?? null) : null;
}

/**
 * Accepts a video id or a youtube.com or youtu.be link to one video and
 * returns the id. Anything else is rejected, so no caller-supplied host or
 * path is ever requested.
 */
export function parseVideoRef(input: string): string {
  const text = input.trim();
  const id = VIDEO_ID_PATTERN.test(text) ? text : idFromUrl(text);
  if (id !== null && VIDEO_ID_PATTERN.test(id)) return id;
  throw new Error(`Not a valid YouTube video id or link: "${text.slice(0, MAX_ECHOED_INPUT)}"`);
}

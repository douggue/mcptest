/**
 * One video's public watch page as HTML, read signed out, for the signs of
 * earning it embeds (see `money/watchSigns.ts`). The address is built here
 * from a checked video id, so no caller-supplied host or path is requested.
 */
import { readCapped } from './images';
import { VIDEO_ID_PATTERN } from './parse';

/** A watch page comes to about 1.6 MB (seen live, November 2026); this allows some growth. */
export const MAX_WATCH_PAGE_BYTES = 6_000_000;
export const WATCH_TIMEOUT_MS = 20_000;
/** The page is asked for in English, like every listing the source reads. */
const LANGUAGE = 'en';

export function watchPageUrl(videoId: string): string {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
  }
  return `https://www.youtube.com/watch?v=${videoId}&hl=${LANGUAGE}`;
}

export const WATCH_HEADERS: Readonly<Record<string, string>> = { 'accept-language': LANGUAGE };

/** The page's text, or a refusal carrying its status so the limiter can retry one that may pass. */
export async function readWatchResponse(videoId: string, response: Response): Promise<string> {
  if (!response.ok) {
    throw Object.assign(
      new Error(`YouTube would not show the page of video ${videoId} (status ${response.status})`),
      { status: response.status },
    );
  }
  const bytes = await readCapped(response, MAX_WATCH_PAGE_BYTES);
  if (bytes === null) throw new Error(`The page of video ${videoId} is too large to read`);
  return Buffer.from(bytes).toString('utf8');
}

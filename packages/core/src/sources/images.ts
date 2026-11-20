import { VIDEO_ID_PATTERN } from './parse';

/**
 * Fetches pictures from YouTube's image hosts and nowhere else.
 *
 * Every address comes from a validated id or from a page YouTube returned,
 * which is untrusted, so each one is checked against a short list of hosts
 * before any request is made. Redirects are refused, so a request cannot be
 * led to another host; every read has a time limit and a size cap.
 */

/** The host of video thumbnails and of storyboard sheets (frames across a video). */
export const VIDEO_IMAGE_HOST = 'i.ytimg.com';
/**
 * The host of channel logos and covers. It is the only one seen in the channel
 * pages read so far: the recorded fixture and the live check both name it for
 * the logo and the cover alike. An address on any other host is not read.
 */
export const CHANNEL_IMAGE_HOSTS: readonly string[] = ['yt3.googleusercontent.com'];

/** 480 by 360: enough to judge a thumbnail, small enough to be cheap to look at. */
const THUMBNAIL_FILE = 'hqdefault.jpg';
const IMAGE_TIMEOUT_MS = 10_000;
/** Thumbnails are usually 10 to 60 KB; anything far larger is not a thumbnail. */
export const MAX_THUMBNAIL_BYTES = 400_000;
/** A sheet of twenty-five small frames runs to about 50 KB; the same cap as a thumbnail is ample. */
const MAX_STORYBOARD_BYTES = MAX_THUMBNAIL_BYTES;
/** A cover a thousand pixels wide runs to a few hundred KB, a logo to far less. */
const MAX_CHANNEL_IMAGE_BYTES = 1_000_000;

const TYPE_NAMES: Readonly<Record<string, string>> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

/** What an image must be to be read: where it is, what kind it is, and how large at most. */
export interface ImageRule {
  /** The word for the picture in a message, such as "thumbnail". */
  readonly what: string;
  readonly hosts: readonly string[];
  readonly types: readonly string[];
  readonly maxBytes: number;
}

export const THUMBNAIL_RULE: ImageRule = {
  what: 'thumbnail',
  hosts: [VIDEO_IMAGE_HOST],
  types: ['image/jpeg'],
  maxBytes: MAX_THUMBNAIL_BYTES,
};

export const STORYBOARD_RULE: ImageRule = {
  what: 'frame sheet',
  hosts: [VIDEO_IMAGE_HOST],
  types: ['image/jpeg', 'image/webp'],
  maxBytes: MAX_STORYBOARD_BYTES,
};

export const CHANNEL_IMAGE_RULE: ImageRule = {
  what: 'channel image',
  hosts: CHANNEL_IMAGE_HOSTS,
  types: ['image/jpeg', 'image/png', 'image/webp'],
  maxBytes: MAX_CHANNEL_IMAGE_BYTES,
};

/** The part of `fetch` this module uses, so tests can stand in for the network. */
export type FetchImage = (
  url: string,
  init: { readonly signal: AbortSignal; readonly redirect: 'error' },
) => Promise<Response>;

export type FetchedImage =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly mimeType: string }
  | { readonly ok: false; readonly reason: string };

const failed = (reason: string): FetchedImage => ({ ok: false, reason });

/** Whether an address is plain https on one of the rule's hosts, with nothing else in it. */
export function isPinnedImageUrl(url: string, rule: Pick<ImageRule, 'hosts'>): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    rule.hosts.includes(parsed.hostname) &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === ''
  );
}

/** The address of a video's thumbnail. Throws for anything that is not a video id. */
export function thumbnailUrl(videoId: string): string {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error(`Not a valid YouTube video id: "${videoId.slice(0, 40)}"`);
  }
  return `https://${VIDEO_IMAGE_HOST}/vi/${videoId}/${THUMBNAIL_FILE}`;
}

/** Reads a response body, giving up as soon as it passes the cap. Null means too large. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function typeProblem(rule: ImageRule): string {
  const names = rule.types.map((type) => TYPE_NAMES[type] ?? type);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0];
  return `the answer was not a ${list} image`;
}

async function readImage(response: Response, rule: ImageRule): Promise<FetchedImage> {
  if (!response.ok) return failed(`YouTube has no ${rule.what} for it (status ${response.status})`);
  const type = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase();
  if (type === undefined || !rule.types.includes(type)) return failed(typeProblem(rule));
  if (Number(response.headers.get('content-length') ?? 0) > rule.maxBytes) {
    return failed('the image is too large');
  }
  const bytes = await readCapped(response, rule.maxBytes);
  if (bytes === null) return failed('the image is too large');
  if (bytes.byteLength === 0) return failed('the image was empty');
  return { ok: true, bytes, mimeType: type };
}

/**
 * Fetches one image from an address that must be on one of the rule's hosts.
 * Never throws: a failure comes back as a short reason with no network
 * details in it. No request is made for an address that is not pinned.
 */
export async function fetchPinnedImage(
  url: string,
  rule: ImageRule,
  fetchImage: FetchImage = fetch,
): Promise<FetchedImage> {
  if (!isPinnedImageUrl(url, rule)) {
    return failed('its address is not on the image host Jgtube reads');
  }
  try {
    const response = await fetchImage(url, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      redirect: 'error',
    });
    return await readImage(response, rule);
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return failed(timedOut ? 'it took too long to load' : 'the image could not be reached');
  }
}

/** Fetches one video's thumbnail; see `fetchPinnedImage`. */
export async function fetchThumbnail(
  videoId: string,
  fetchImage: FetchImage = fetch,
): Promise<FetchedImage> {
  if (!VIDEO_ID_PATTERN.test(videoId)) return failed('that is not a video id');
  return fetchPinnedImage(thumbnailUrl(videoId), THUMBNAIL_RULE, fetchImage);
}

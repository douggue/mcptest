/** The only host an image is ever requested from. */
const THUMBNAIL_HOST = 'https://i.ytimg.com';
/** 480 by 360: enough to judge a thumbnail, small enough to be cheap to look at. */
const THUMBNAIL_FILE = 'hqdefault.jpg';
const THUMBNAIL_TIMEOUT_MS = 10_000;
/** These files are usually 10 to 60 KB; anything far larger is not a thumbnail. */
export const MAX_THUMBNAIL_BYTES = 400_000;
const JPEG_TYPE = 'image/jpeg';

/** The part of `fetch` this module uses, so tests can stand in for the network. */
export type FetchImage = (
  url: string,
  init: { readonly signal: AbortSignal; readonly redirect: 'error' },
) => Promise<Response>;

export type ThumbnailImage =
  | { readonly ok: true; readonly data: string; readonly mimeType: string }
  | { readonly ok: false; readonly reason: string };

/** The caller must have checked `videoId` against the video id pattern. */
export function thumbnailUrl(videoId: string): string {
  return `${THUMBNAIL_HOST}/vi/${videoId}/${THUMBNAIL_FILE}`;
}

const failed = (reason: string): ThumbnailImage => ({ ok: false, reason });

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

async function readImage(response: Response): Promise<ThumbnailImage> {
  if (!response.ok) return failed(`YouTube has no thumbnail for it (status ${response.status})`);
  const type = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase();
  if (type !== JPEG_TYPE) return failed('the answer was not a JPEG image');
  if (Number(response.headers.get('content-length') ?? 0) > MAX_THUMBNAIL_BYTES) {
    return failed('the image is too large');
  }
  const bytes = await readCapped(response, MAX_THUMBNAIL_BYTES);
  if (bytes === null) return failed('the image is too large');
  if (bytes.byteLength === 0) return failed('the image was empty');
  return { ok: true, data: Buffer.from(bytes).toString('base64'), mimeType: JPEG_TYPE };
}

/**
 * Fetches one video's thumbnail. Never throws: a failure comes back as a short
 * reason with no network details in it. Redirects are refused, so the request
 * cannot be led to another host.
 */
export async function fetchThumbnail(
  videoId: string,
  fetchImage: FetchImage = fetch,
): Promise<ThumbnailImage> {
  try {
    const response = await fetchImage(thumbnailUrl(videoId), {
      signal: AbortSignal.timeout(THUMBNAIL_TIMEOUT_MS),
      redirect: 'error',
    });
    return await readImage(response);
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return failed(timedOut ? 'it took too long to load' : 'the image could not be reached');
  }
}

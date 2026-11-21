import { describe, expect, test } from 'vitest';
import {
  CHANNEL_IMAGE_HOSTS,
  CHANNEL_IMAGE_RULE,
  MAX_THUMBNAIL_BYTES,
  STORYBOARD_RULE,
  VIDEO_IMAGE_HOST,
  fetchPinnedImage,
  fetchThumbnail,
  isPinnedImageUrl,
  thumbnailUrl,
  type FetchImage,
} from '../src/sources/images';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const imageResponse = (
  body: Uint8Array<ArrayBuffer> = JPEG,
  headers: Record<string, string> = {},
): Response => new Response(body, { headers: { 'content-type': 'image/jpeg', ...headers } });

describe('thumbnailUrl', () => {
  test('points at the one image host and nothing else', () => {
    expect(thumbnailUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(VIDEO_IMAGE_HOST).toBe('i.ytimg.com');
  });

  test('refuses anything that is not a video id', () => {
    expect(() => thumbnailUrl('../../etc/passwd')).toThrow(/video id/);
  });
});

describe('fetchThumbnail', () => {
  test('returns the image bytes with their type', async () => {
    const calls: Array<{ url: string; redirect: unknown; hasSignal: boolean }> = [];
    const fetchImage: FetchImage = async (url, init) => {
      calls.push({ url, redirect: init.redirect, hasSignal: init.signal instanceof AbortSignal });
      return imageResponse();
    };

    const image = await fetchThumbnail('dQw4w9WgXcQ', fetchImage);

    expect(image).toEqual({ ok: true, bytes: Buffer.from(JPEG), mimeType: 'image/jpeg' });
    expect(calls).toEqual([
      {
        url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        // A redirect could lead to another host, so it is refused.
        redirect: 'error',
        hasSignal: true,
      },
    ]);
  });

  test('makes no request for something that is not a video id', async () => {
    let fetches = 0;
    const image = await fetchThumbnail('not a video', async () => {
      fetches += 1;
      return imageResponse();
    });

    expect(image).toEqual({ ok: false, reason: 'that is not a video id' });
    expect(fetches).toBe(0);
  });

  test('reports a missing thumbnail', async () => {
    const image = await fetchThumbnail(
      'dQw4w9WgXcQ',
      async () => new Response('gone', { status: 404 }),
    );

    expect(image).toEqual({ ok: false, reason: 'YouTube has no thumbnail for it (status 404)' });
  });

  test('refuses an answer that is not a JPEG image', async () => {
    const image = await fetchThumbnail(
      'dQw4w9WgXcQ',
      async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    );

    expect(image).toEqual({ ok: false, reason: 'the answer was not a JPEG image' });
  });

  test('refuses an image that announces a size over the cap', async () => {
    const image = await fetchThumbnail('dQw4w9WgXcQ', async () =>
      imageResponse(JPEG, { 'content-length': String(MAX_THUMBNAIL_BYTES + 1) }),
    );

    expect(image).toEqual({ ok: false, reason: 'the image is too large' });
  });

  test('stops reading an image that turns out to be over the cap', async () => {
    const image = await fetchThumbnail('dQw4w9WgXcQ', async () =>
      imageResponse(new Uint8Array(MAX_THUMBNAIL_BYTES + 1)),
    );

    expect(image).toEqual({ ok: false, reason: 'the image is too large' });
  });

  test('refuses an empty image', async () => {
    const image = await fetchThumbnail('dQw4w9WgXcQ', async () => imageResponse(new Uint8Array()));

    expect(image).toEqual({ ok: false, reason: 'the image was empty' });
  });

  test('reports a timeout in plain words', async () => {
    const image = await fetchThumbnail('dQw4w9WgXcQ', async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });

    expect(image).toEqual({ ok: false, reason: 'it took too long to load' });
  });

  test('reports a network failure without its details', async () => {
    const image = await fetchThumbnail('dQw4w9WgXcQ', async () => {
      throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.1:443 /etc/ssl/cert.pem');
    });

    expect(image).toEqual({ ok: false, reason: 'the image could not be reached' });
  });
});

describe('fetchPinnedImage', () => {
  const never: FetchImage = async () => {
    throw new Error('no request should be made');
  };

  test('reads a storyboard sheet from the video image host', async () => {
    const urls: string[] = [];
    const sheet = 'https://i.ytimg.com/sb/dQw4w9WgXcQ/storyboard3_L2/M0.jpg?sqp=abc&sigh=rs%24xyz';

    const image = await fetchPinnedImage(sheet, STORYBOARD_RULE, async (url) => {
      urls.push(url);
      return imageResponse();
    });

    expect(image.ok).toBe(true);
    expect(urls).toEqual([sheet]);
  });

  test('reads a channel image from the host YouTube serves them from', async () => {
    expect(CHANNEL_IMAGE_HOSTS).toEqual(['yt3.googleusercontent.com']);
    const image = await fetchPinnedImage(
      'https://yt3.googleusercontent.com/abc=s160-c-k-c0x00ffffff-no-rj',
      CHANNEL_IMAGE_RULE,
      async () => new Response(JPEG, { headers: { 'content-type': 'image/png' } }),
    );

    expect(image).toMatchObject({ ok: true, mimeType: 'image/png' });
  });

  test.each([
    ['another host', 'https://evil.example/sb/x/M0.jpg'],
    ['a look-alike host', 'https://i.ytimg.com.evil.example/sb/x/M0.jpg'],
    ['plain http', 'http://i.ytimg.com/sb/x/M0.jpg'],
    ['a name and password', 'https://user:pass@i.ytimg.com/sb/x/M0.jpg'],
    ['another port', 'https://i.ytimg.com:8443/sb/x/M0.jpg'],
    ['no address at all', 'not a url'],
    ['a file on this computer', 'file:///etc/passwd'],
  ])('makes no request to %s', async (_what, url) => {
    expect(isPinnedImageUrl(url, STORYBOARD_RULE)).toBe(false);
    expect(await fetchPinnedImage(url, STORYBOARD_RULE, never)).toEqual({
      ok: false,
      reason: 'its address is not on the image host Jgtube reads',
    });
  });

  test('names the kinds of image a rule accepts when the answer is another', async () => {
    const image = await fetchPinnedImage(
      'https://yt3.googleusercontent.com/abc',
      CHANNEL_IMAGE_RULE,
      async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
    );

    expect(image).toEqual({ ok: false, reason: 'the answer was not a JPEG, PNG or WebP image' });
  });
});

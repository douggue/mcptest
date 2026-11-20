import { describe, expect, test } from 'vitest';
import {
  MAX_THUMBNAIL_BYTES,
  fetchThumbnail,
  thumbnailUrl,
  type FetchImage,
} from '../src/thumbnailImages';
import { createToolHandlers } from '../src/tools';
import { FakeEngine, textOf } from './fakes';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const JPEG_BASE64 = Buffer.from(JPEG).toString('base64');

const jpegResponse = (
  body: Uint8Array<ArrayBuffer> = JPEG,
  headers: Record<string, string> = {},
): Response => new Response(body, { headers: { 'content-type': 'image/jpeg', ...headers } });

describe('thumbnailUrl', () => {
  test('points at the one image host and nothing else', () => {
    expect(thumbnailUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });
});

describe('fetchThumbnail', () => {
  test('returns the image as base64 with its type', async () => {
    const calls: Array<{ url: string; redirect: unknown; hasSignal: boolean }> = [];
    const fetchImage: FetchImage = async (url, init) => {
      calls.push({ url, redirect: init.redirect, hasSignal: init.signal instanceof AbortSignal });
      return jpegResponse();
    };

    const image = await fetchThumbnail('dQw4w9WgXcQ', fetchImage);

    expect(image).toEqual({ ok: true, data: JPEG_BASE64, mimeType: 'image/jpeg' });
    expect(calls).toEqual([
      {
        url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        // A redirect could lead to another host, so it is refused.
        redirect: 'error',
        hasSignal: true,
      },
    ]);
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
      jpegResponse(JPEG, { 'content-length': String(MAX_THUMBNAIL_BYTES + 1) }),
    );

    expect(image).toEqual({ ok: false, reason: 'the image is too large' });
  });

  test('stops reading an image that turns out to be over the cap', async () => {
    const image = await fetchThumbnail('dQw4w9WgXcQ', async () =>
      jpegResponse(new Uint8Array(MAX_THUMBNAIL_BYTES + 1)),
    );

    expect(image).toEqual({ ok: false, reason: 'the image is too large' });
  });

  test('refuses an empty image', async () => {
    const image = await fetchThumbnail('dQw4w9WgXcQ', async () => jpegResponse(new Uint8Array()));

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

describe('view_thumbnails', () => {
  const tools = (fetchImage: FetchImage) =>
    createToolHandlers({ engine: new FakeEngine(), fetchImage, log: () => {} });

  test('returns each thumbnail as an image the model can look at', async () => {
    const result = await tools(async () => jpegResponse()).viewThumbnails({
      video_ids: ['aaaaaaaaaa1', 'bbbbbbbbbb1'],
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: 'text', text: 'Thumbnail of video aaaaaaaaaa1:' },
      { type: 'image', data: JPEG_BASE64, mimeType: 'image/jpeg' },
      { type: 'text', text: 'Thumbnail of video bbbbbbbbbb1:' },
      { type: 'image', data: JPEG_BASE64, mimeType: 'image/jpeg' },
    ]);
  });

  test('a failed image is reported in words and the others still come back', async () => {
    const result = await tools(async (url) =>
      url.includes('bbbbbbbbbb1') ? new Response('', { status: 404 }) : jpegResponse(),
    ).viewThumbnails({ video_ids: ['aaaaaaaaaa1', 'bbbbbbbbbb1'] });

    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: 'text', text: 'Thumbnail of video aaaaaaaaaa1:' },
      { type: 'image', data: JPEG_BASE64, mimeType: 'image/jpeg' },
      {
        type: 'text',
        text: 'Thumbnail of video bbbbbbbbbb1 could not be shown: YouTube has no thumbnail for it (status 404)',
      },
    ]);
  });

  test('is an error only when no image could be shown at all', async () => {
    const result = await tools(async () => new Response('', { status: 500 })).viewThumbnails({
      video_ids: ['aaaaaaaaaa1'],
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('could not be shown');
  });

  test('fetches a repeated id once', async () => {
    let fetches = 0;
    const result = await tools(async () => {
      fetches += 1;
      return jpegResponse();
    }).viewThumbnails({ video_ids: ['aaaaaaaaaa1', 'aaaaaaaaaa1'] });

    expect(fetches).toBe(1);
    expect(result.content).toHaveLength(2);
  });

  test('refuses anything that is not a video id, before any request is made', async () => {
    let fetches = 0;
    const result = await tools(async () => {
      fetches += 1;
      return jpegResponse();
    }).viewThumbnails({ video_ids: ['aaaaaaaaaa1', '../../etc/passwd'] });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Video ids are 11 characters: letters, digits, "-" and "_".');
    expect(fetches).toBe(0);
  });

  test('refuses more ids than the limit', async () => {
    const ids = Array.from({ length: 9 }, (_, n) => `aaaaaaaaaa${n}`);

    const result = await tools(async () => jpegResponse()).viewThumbnails({ video_ids: ids });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Give 1 to 8 video ids at a time.');
  });
});

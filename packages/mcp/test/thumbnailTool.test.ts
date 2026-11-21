import type { FetchImage } from '@jgtube/core';
import { describe, expect, test } from 'vitest';
import { createToolHandlers } from '../src/tools';
import { FakeEngine, textOf } from './fakes';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const JPEG_BASE64 = Buffer.from(JPEG).toString('base64');

const jpegResponse = (
  body: Uint8Array<ArrayBuffer> = JPEG,
  headers: Record<string, string> = {},
): Response => new Response(body, { headers: { 'content-type': 'image/jpeg', ...headers } });

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

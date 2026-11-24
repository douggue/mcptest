import { describe, expect, test } from 'vitest';
import { uploadFormatImage, type UploadRequest } from '../src/lib/upload';

function standIn(calls: unknown[][]): UploadRequest {
  return {
    status: 201,
    responseText: JSON.stringify({ success: true, data: { file: 'Ab-_cdEFgh1.png' } }),
    upload: { onprogress: null },
    onload: null,
    onerror: null,
    onabort: null,
    open: (...args) => void calls.push(['open', ...args]),
    setRequestHeader: (...args) => void calls.push(['header', ...args]),
    send: () => void calls.push(['send']),
  };
}

describe('uploadFormatImage', () => {
  test('sends the picture with its own type, or PNG when the browser names none', async () => {
    const calls: unknown[][] = [];
    const request = standIn(calls);
    const sending = uploadFormatImage(
      new Blob(['x'], { type: 'image/webp' }),
      () => undefined,
      () => request,
    );
    request.onload?.();
    expect(await sending).toEqual({ file: 'Ab-_cdEFgh1.png' });
    const untyped = standIn(calls);
    const second = uploadFormatImage(
      new Blob(['x']),
      () => undefined,
      () => untyped,
    );
    untyped.onload?.();
    await second;
    expect(calls).toEqual([
      ['open', 'PUT', '/api/format/images'],
      ['header', 'content-type', 'image/webp'],
      ['send'],
      ['open', 'PUT', '/api/format/images'],
      ['header', 'content-type', 'image/png'],
      ['send'],
    ]);
  });
});

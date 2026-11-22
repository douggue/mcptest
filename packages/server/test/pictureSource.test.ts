import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VideoFrames } from '@jgtube/core';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { MAX_TEARDOWN_PICTURES, pictureSource, type PictureSourceDeps } from '../src/pictureSource';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
const A = 'aaaaaaaaaaa';
const B = 'bbbbbbbbbbb';

let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-picture-source-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function teardownPictures(videoId: string, names: readonly string[]): void {
  const folder = join(root, 'teardowns', videoId);
  mkdirSync(folder, { recursive: true });
  for (const name of names) writeFileSync(join(folder, name), JPEG);
}

const sheet = (index: number, ok: boolean) => ({
  sheet: {
    index,
    columns: 5,
    rows: 5,
    frames: 25,
    intervalMs: 2000,
    firstFrameMs: index * 50_000,
    lastFrameMs: index * 50_000 + 48_000,
  },
  caption: `Sheet ${index + 1} of 3: a grid 5 across and 5 down.`,
  image: ok
    ? { ok: true as const, bytes: JPEG, mimeType: 'image/jpeg' }
    : { ok: false as const, reason: 'gone' },
});

function deps(over: Partial<PictureSourceDeps> = {}): PictureSourceDeps {
  return {
    board: () => null,
    fetchThumbnail: async () => ({ ok: true, bytes: JPEG, mimeType: 'image/jpeg' }),
    downloads: () => root,
    readFrames: async () => null,
    ...over,
  };
}

describe('the pictures a question needs, as files', () => {
  test('thumbnails by role, each named after its video id', async () => {
    const set = await pictureSource(deps())('UCx', {
      kind: 'thumbnails',
      groups: [
        { label: 'top videos', videoIds: [A] },
        { label: 'ordinary videos', videoIds: [B, 'not an id'] },
      ],
    });

    expect(set.files.map((file) => file.name)).toEqual([`thumb-${A}.jpg`, `thumb-${B}.jpg`]);
    expect(set.listing).toBe(`top videos: @thumb-${A}.jpg; ordinary videos: @thumb-${B}.jpg`);
  });

  test('a teardown’s strips and keyframes, as many as its tool would show, named with the video', async () => {
    teardownPictures(A, ['s-001.jpg', 's-002.jpg', 'k-001.jpg', 'hook.jpg', 'notes.txt']);

    const set = await pictureSource(deps())('UCx', { kind: 'teardown', videoIds: [A, B] });

    expect(set.files.map((file) => file.name)).toEqual([
      `${A}-s-001.jpg`,
      `${A}-s-002.jpg`,
      `${A}-k-001.jpg`,
    ]);
    expect(set.listing).toContain(`@${A}-s-001.jpg`);
  });

  test('caps a teardown’s pictures over all the videos', async () => {
    const strips = Array.from({ length: 6 }, (_, n) => `s-00${n + 1}.jpg`);
    const keys = Array.from({ length: 4 }, (_, n) => `k-00${n + 1}.jpg`);
    const ids = ['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3'];
    for (const id of ids) teardownPictures(id, [...strips, ...keys]);

    const set = await pictureSource(deps())('UCx', { kind: 'teardown', videoIds: ids });

    expect(set.files).toHaveLength(MAX_TEARDOWN_PICTURES);
  });

  test('no teardown pictures is an empty set, not a failure', async () => {
    const set = await pictureSource(deps({ downloads: () => null }))('UCx', {
      kind: 'teardown',
      videoIds: [A],
    });
    expect(set).toEqual({ files: [], listing: 'none' });
  });

  test('a video’s frame sheets, each listed with its grid and times, the ones that failed left out', async () => {
    const frames: VideoFrames = {
      videoId: A,
      source: 'preview',
      sheetCount: 3,
      frameCount: 75,
      frameWidth: 80,
      frameHeight: 45,
      sheets: [sheet(0, true), sheet(1, false), sheet(2, true)],
    };
    const asked: Array<[string, number, number]> = [];
    const source = pictureSource(
      deps({
        readFrames: async (videoId, sheets, from) => {
          asked.push([videoId, sheets, from]);
          return frames;
        },
      }),
    );

    const set = await source('', { kind: 'frames', videoId: A });

    expect(asked).toEqual([[A, 60, 0]]);
    expect(set.files.map((file) => file.name)).toEqual(['frames-01.jpg', 'frames-03.jpg']);
    expect(set.listing).toContain('the video has 75 frames on 3 sheets');
    expect(set.listing).toContain('@frames-03.jpg is Sheet 3 of 3');
  });

  test('refuses frames for a video with none', async () => {
    await expect(pictureSource(deps())('', { kind: 'frames', videoId: A })).rejects.toThrow(
      /no frames/,
    );
  });

  test('the board’s thumbnails, or a plain refusal when the channel has no map', async () => {
    await expect(pictureSource(deps())('UCx', { kind: 'board' })).rejects.toThrow(/no map/);
  });
});

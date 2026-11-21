import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  MAX_OWN_VIDEO_BYTES,
  OWN_VIDEOS_FOLDER,
  findOwnVideo,
  ownVideosFolder,
} from '../src/downloads/ownVideos';

const VIDEO = 'wE5ETbiq1qQ';

let root: string;
let folder: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jgtube-own-'));
  folder = join(root, 'my-videos');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const put = (name: string): string => {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, name);
  writeFileSync(path, 'a video');
  return path;
};

describe('the folder for the owner’s own video files', () => {
  test('is "my-videos" inside the downloads folder, and takes files up to two gigabytes', () => {
    expect(OWN_VIDEOS_FOLDER).toBe('my-videos');
    expect(ownVideosFolder(root)).toBe(folder);
    expect(MAX_OWN_VIDEO_BYTES).toBe(2_000_000_000);
  });
});

describe('findOwnVideo', () => {
  test('finds nothing when the folder does not exist yet, or holds no file for the video', async () => {
    expect(await findOwnVideo(root, VIDEO)).toBeNull();
    put('another video [aaaaaaaaaaa].mp4');

    expect(await findOwnVideo(root, VIDEO)).toBeNull();
  });

  test('finds the file named exactly by the video id', async () => {
    const exact = put(`${VIDEO}.mp4`);

    expect(await findOwnVideo(root, VIDEO)).toBe(exact);
  });

  test('finds a file whose name holds the id anywhere, as a downloader names it', async () => {
    const named = put(`How it was built [${VIDEO}].MP4`);

    expect(await findOwnVideo(root, VIDEO)).toBe(named);
  });

  test('prefers the exact name when two files match, and else the first by name', async () => {
    const second = put(`b copy ${VIDEO}.mp4`);
    const first = put(`a copy ${VIDEO}.mp4`);

    expect(await findOwnVideo(root, VIDEO)).toBe(first);
    expect(second).not.toBe(first);

    const exact = put(`${VIDEO}.mp4`);

    expect(await findOwnVideo(root, VIDEO)).toBe(exact);
  });

  test('takes only MP4 files, never a half-sent one or a folder', async () => {
    put(`${VIDEO}.mp4.part-1234`);
    put(`${VIDEO}.webm`);
    mkdirSync(join(folder, `folder ${VIDEO}.mp4`));

    expect(await findOwnVideo(root, VIDEO)).toBeNull();
  });

  test('refuses anything that is not a video id', async () => {
    put(`${VIDEO}.mp4`);

    await expect(findOwnVideo(root, '../../etc')).rejects.toThrow(/video id/);
    await expect(findOwnVideo(root, '')).rejects.toThrow(/video id/);
  });
});
